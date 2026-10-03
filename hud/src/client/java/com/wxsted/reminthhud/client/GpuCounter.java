package com.wxsted.reminthhud.client;

import static java.lang.foreign.ValueLayout.ADDRESS;
import static java.lang.foreign.ValueLayout.JAVA_DOUBLE;
import static java.lang.foreign.ValueLayout.JAVA_INT;
import static java.lang.foreign.ValueLayout.JAVA_LONG;

import java.lang.foreign.Arena;
import java.lang.foreign.FunctionDescriptor;
import java.lang.foreign.Linker;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.SymbolLookup;
import java.lang.invoke.MethodHandle;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * The whole PC's GPU load, the number Task Manager shows, read from Windows'
 * own performance counters (pdh.dll) through Java's foreign-function API - no
 * extra library, no JNI, no helper process.
 *
 * Not thread-safe: open it, sample it and close it on ONE thread (the
 * sampler thread in SystemLoad).
 */
final class GpuCounter implements AutoCloseable {
	private static final int ERROR_SUCCESS = 0;
	private static final int PDH_MORE_DATA = 0x800007D2;
	private static final int PDH_FMT_DOUBLE = 0x00000200;
	// Per-engine values can go over 100 for a moment; the sums are capped below.
	private static final int PDH_FMT_NOCAP100 = 0x00008000;
	private static final int PDH_CSTATUS_VALID_DATA = 0;
	private static final int PDH_CSTATUS_NEW_DATA = 1;
	// PDH_FMT_COUNTERVALUE_ITEM_W on 64-bit Windows: a name pointer (8 bytes),
	// then PDH_FMT_COUNTERVALUE: a status (4), padding (4), the double (8).
	private static final long ITEM_SIZE = 24;
	private static final long ITEM_STATUS = 8;
	private static final long ITEM_VALUE = 16;
	// Instance names are short ("pid_1234_luid_0x..._phys_0_eng_3_engtype_3D").
	private static final long MAX_NAME_BYTES = 1024;

	private final Arena arena;
	private final MethodHandle collect;
	private final MethodHandle getArray;
	private final MethodHandle closeQuery;
	private final MemorySegment query;
	private final MemorySegment counter;
	private final MemorySegment size;
	private final MemorySegment count;
	private Arena bufferArena = Arena.ofConfined();
	private MemorySegment buffer = MemorySegment.NULL;
	private int bufferBytes = 0;
	private boolean closed = false;

	private GpuCounter(Arena arena, MethodHandle collect, MethodHandle getArray, MethodHandle closeQuery, MemorySegment query, MemorySegment counter) {
		this.arena = arena;
		this.collect = collect;
		this.getArray = getArray;
		this.closeQuery = closeQuery;
		this.query = query;
		this.counter = counter;
		this.size = arena.allocate(JAVA_INT);
		this.count = arena.allocate(JAVA_INT);
	}

	/** Throws when this PC can't give the number (not Windows, counter missing, native access refused...). */
	static GpuCounter open() throws Throwable {
		if (!System.getProperty("os.name", "").toLowerCase(Locale.ROOT).startsWith("windows")) {
			throw new UnsupportedOperationException("not Windows");
		}
		Arena arena = Arena.ofConfined();
		try {
			Linker linker = Linker.nativeLinker();
			SymbolLookup pdh = SymbolLookup.libraryLookup("pdh", arena);
			MethodHandle openQuery = linker.downcallHandle(pdh.find("PdhOpenQueryW").orElseThrow(),
					FunctionDescriptor.of(JAVA_INT, ADDRESS, JAVA_LONG, ADDRESS));
			MethodHandle addCounter = linker.downcallHandle(pdh.find("PdhAddEnglishCounterW").orElseThrow(),
					FunctionDescriptor.of(JAVA_INT, ADDRESS, ADDRESS, JAVA_LONG, ADDRESS));
			MethodHandle collect = linker.downcallHandle(pdh.find("PdhCollectQueryData").orElseThrow(),
					FunctionDescriptor.of(JAVA_INT, ADDRESS));
			MethodHandle getArray = linker.downcallHandle(pdh.find("PdhGetFormattedCounterArrayW").orElseThrow(),
					FunctionDescriptor.of(JAVA_INT, ADDRESS, JAVA_INT, ADDRESS, ADDRESS, ADDRESS));
			MethodHandle closeQuery = linker.downcallHandle(pdh.find("PdhCloseQuery").orElseThrow(),
					FunctionDescriptor.of(JAVA_INT, ADDRESS));

			MemorySegment queryOut = arena.allocate(ADDRESS);
			int st = (int) openQuery.invokeExact(MemorySegment.NULL, 0L, queryOut);
			if (st != ERROR_SUCCESS) throw new IllegalStateException("PdhOpenQueryW " + Integer.toHexString(st));
			MemorySegment query = queryOut.get(ADDRESS, 0);

			// Every GPU engine of every process; summed up in sample().
			MemorySegment path = arena.allocateFrom("\\GPU Engine(*)\\Utilization Percentage", StandardCharsets.UTF_16LE);
			MemorySegment counterOut = arena.allocate(ADDRESS);
			st = (int) addCounter.invokeExact(query, path, 0L, counterOut);
			if (st != ERROR_SUCCESS) {
				int ignored = (int) closeQuery.invokeExact(query);
				throw new IllegalStateException("PdhAddEnglishCounterW " + Integer.toHexString(st));
			}
			GpuCounter c = new GpuCounter(arena, collect, getArray, closeQuery, query, counterOut.get(ADDRESS, 0));
			// A rate counter needs two readings before it has a value: take the first now.
			int first = (int) collect.invokeExact(query);
			return c;
		} catch (Throwable t) {
			arena.close();
			throw t;
		}
	}

	/** 0-100, or -1 when Windows has no value this time (the first second, a busy moment). */
	int sample() throws Throwable {
		if (closed) return -1;
		int st = (int) collect.invokeExact(query);
		if (st != ERROR_SUCCESS) return -1;
		// The list of processes can grow between the size question and the
		// real call, so ask again a couple of times.
		for (int attempt = 0; attempt < 3; attempt++) {
			size.set(JAVA_INT, 0, bufferBytes);
			st = (int) getArray.invokeExact(counter, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, size, count, buffer);
			if (st == PDH_MORE_DATA) {
				grow(size.get(JAVA_INT, 0));
				continue;
			}
			if (st != ERROR_SUCCESS) return -1;
			return busiest(count.get(JAVA_INT, 0));
		}
		return -1;
	}

	/**
	 * Task Manager's GPU figure: for each engine of each graphics card (3D,
	 * Compute, VideoDecode, Copy...), add up what every process uses on it,
	 * then take the busiest engine. Adding all engines together would count
	 * one frame several times; the busiest engine is what limits the card.
	 */
	private int busiest(int items) {
		Map<String, Double> perEngine = new HashMap<>();
		for (int i = 0; i < items; i++) {
			long base = i * ITEM_SIZE;
			int status = buffer.get(JAVA_INT, base + ITEM_STATUS);
			if (status != PDH_CSTATUS_VALID_DATA && status != PDH_CSTATUS_NEW_DATA) continue;
			double value = buffer.get(JAVA_DOUBLE, base + ITEM_VALUE);
			if (!(value > 0)) continue;
			MemorySegment namePtr = buffer.get(ADDRESS, base);
			if (namePtr.equals(MemorySegment.NULL)) continue;
			String name = namePtr.reinterpret(MAX_NAME_BYTES).getString(0, StandardCharsets.UTF_16LE);
			perEngine.merge(engineKey(name), value, Double::sum);
		}
		double max = 0;
		for (double v : perEngine.values()) max = Math.max(max, v);
		return (int) Math.round(Math.min(100.0, max));
	}

	/**
	 * "pid_1234_luid_0x0_0xD1A4_phys_0_eng_3_engtype_Copy" -> "0x0_0xD1A4_phys_0_eng_3":
	 * the card and the engine on it, whichever process is using it.
	 */
	static String engineKey(String instance) {
		int luid = instance.indexOf("luid_");
		int type = instance.indexOf("_engtype_");
		if (luid < 0 || type <= luid) return instance;
		return instance.substring(luid + 5, type);
	}

	private void grow(int bytes) {
		bufferArena.close();
		bufferArena = Arena.ofConfined();
		// Some room to spare so a new process next second doesn't mean another round.
		bufferBytes = Math.max(bytes, 0) + 4096;
		buffer = bufferArena.allocate(bufferBytes, 8);
	}

	@Override
	public void close() {
		if (closed) return;
		closed = true;
		try {
			int ignored = (int) closeQuery.invokeExact(query);
		} catch (Throwable ignored) {
			// closing anyway
		}
		bufferArena.close();
		arena.close();
	}
}
