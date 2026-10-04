package com.wxsted.reminthhud.client;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import com.sun.jna.Library;
import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.WString;
import com.sun.jna.ptr.IntByReference;
import com.sun.jna.ptr.PointerByReference;

/**
 * The whole PC's GPU load, the number Task Manager shows, read from Windows'
 * own performance counters (pdh.dll). Minecraft 1.21 runs on Java 21, where
 * Java's foreign-function API is still a preview feature, so this uses JNA,
 * which Minecraft already ships with (the 26.x version of this mod uses the
 * foreign-function API instead; same counter, same numbers).
 *
 * Not thread-safe: open it, sample it and close it on ONE thread (the
 * sampler thread in SystemLoad).
 */
final class GpuCounter implements AutoCloseable {
	private interface Pdh extends Library {
		int PdhOpenQueryW(Pointer dataSource, long userData, PointerByReference query);

		int PdhAddEnglishCounterW(Pointer query, WString path, long userData, PointerByReference counter);

		int PdhCollectQueryData(Pointer query);

		int PdhGetFormattedCounterArrayW(Pointer counter, int format, IntByReference bufferSize, IntByReference itemCount, Pointer buffer);

		int PdhCloseQuery(Pointer query);
	}

	private static final int ERROR_SUCCESS = 0;
	private static final int PDH_MORE_DATA = 0x800007D2;
	private static final int PDH_FMT_DOUBLE = 0x00000200;
	private static final int PDH_FMT_NOCAP100 = 0x00008000;
	private static final int PDH_CSTATUS_VALID_DATA = 0;
	private static final int PDH_CSTATUS_NEW_DATA = 1;
	// PDH_FMT_COUNTERVALUE_ITEM_W on 64-bit Windows: a name pointer (8 bytes),
	// then a status (4), padding (4) and the double (8).
	private static final long ITEM_SIZE = 24;
	private static final long ITEM_STATUS = 8;
	private static final long ITEM_VALUE = 16;

	private final Pdh pdh;
	private final Pointer query;
	private final Pointer counter;
	private final IntByReference size = new IntByReference();
	private final IntByReference count = new IntByReference();
	private Memory buffer = null;
	private boolean closed = false;

	private GpuCounter(Pdh pdh, Pointer query, Pointer counter) {
		this.pdh = pdh;
		this.query = query;
		this.counter = counter;
	}

	/** Throws when this PC can't give the number (not Windows, counter missing...). */
	static GpuCounter open() throws Throwable {
		if (!System.getProperty("os.name", "").toLowerCase(Locale.ROOT).startsWith("windows")) {
			throw new UnsupportedOperationException("not Windows");
		}
		Pdh pdh = Native.load("pdh", Pdh.class);
		PointerByReference queryOut = new PointerByReference();
		int st = pdh.PdhOpenQueryW(null, 0L, queryOut);
		if (st != ERROR_SUCCESS) throw new IllegalStateException("PdhOpenQueryW " + Integer.toHexString(st));
		Pointer query = queryOut.getValue();
		PointerByReference counterOut = new PointerByReference();
		st = pdh.PdhAddEnglishCounterW(query, new WString("\\GPU Engine(*)\\Utilization Percentage"), 0L, counterOut);
		if (st != ERROR_SUCCESS) {
			pdh.PdhCloseQuery(query);
			throw new IllegalStateException("PdhAddEnglishCounterW " + Integer.toHexString(st));
		}
		GpuCounter c = new GpuCounter(pdh, query, counterOut.getValue());
		// A rate counter needs two readings before it has a value: take the first now.
		pdh.PdhCollectQueryData(query);
		return c;
	}

	/** 0-100, or -1 when Windows has no value this time (the first second, a busy moment). */
	int sample() {
		if (closed) return -1;
		if (pdh.PdhCollectQueryData(query) != ERROR_SUCCESS) return -1;
		// The list of processes can grow between the size question and the real call.
		for (int attempt = 0; attempt < 3; attempt++) {
			size.setValue(buffer == null ? 0 : (int) buffer.size());
			int st = pdh.PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, size, count, buffer);
			if (st == PDH_MORE_DATA) {
				buffer = new Memory(Math.max(size.getValue(), 0) + 4096L);
				continue;
			}
			if (st != ERROR_SUCCESS || buffer == null) return -1;
			return busiest(count.getValue());
		}
		return -1;
	}

	/**
	 * Task Manager's GPU figure: for each engine of each graphics card (3D,
	 * Compute, VideoDecode, Copy...), add up what every process uses on it,
	 * then take the busiest engine.
	 */
	private int busiest(int items) {
		Map<String, Double> perEngine = new HashMap<>();
		for (int i = 0; i < items; i++) {
			long base = i * ITEM_SIZE;
			int status = buffer.getInt(base + ITEM_STATUS);
			if (status != PDH_CSTATUS_VALID_DATA && status != PDH_CSTATUS_NEW_DATA) continue;
			double value = buffer.getDouble(base + ITEM_VALUE);
			if (!(value > 0)) continue;
			Pointer namePtr = buffer.getPointer(base);
			if (namePtr == null) continue;
			perEngine.merge(engineKey(namePtr.getWideString(0)), value, Double::sum);
		}
		double max = 0;
		for (double v : perEngine.values()) max = Math.max(max, v);
		return (int) Math.round(Math.min(100.0, max));
	}

	/** "pid_1234_luid_0x0_0xD1A4_phys_0_eng_3_engtype_Copy" -> "0x0_0xD1A4_phys_0_eng_3" (the card and the engine on it). */
	static String engineKey(String instance) {
		int luid = instance.indexOf("luid_");
		int type = instance.indexOf("_engtype_");
		if (luid < 0 || type <= luid) return instance;
		return instance.substring(luid + 5, type);
	}

	@Override
	public void close() {
		if (closed) return;
		closed = true;
		try {
			pdh.PdhCloseQuery(query);
		} catch (Throwable ignored) {
			// closing anyway
		}
	}
}
