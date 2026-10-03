package com.wxsted.reminthhud.client;

import java.lang.management.ManagementFactory;

import com.wxsted.reminthhud.ReminthHud;

/**
 * Whole-PC CPU and GPU load, sampled once a second on one background thread.
 * The game's render thread only reads two numbers - it never waits on
 * Windows, and nothing here can throw into the game.
 */
final class SystemLoad {
	/** -1 = no value (yet); otherwise 0-100. */
	static volatile int cpuPercent = -1;
	static volatile int gpuPercent = -1;
	/** False once the GPU number turned out to be unavailable on this PC: the bar leaves it out. */
	static volatile boolean gpuAvailable = true;
	static volatile boolean cpuAvailable = true;

	private static Thread thread;

	private SystemLoad() {
	}

	static synchronized void start(boolean wantCpu, boolean wantGpu) {
		if (thread != null || (!wantCpu && !wantGpu)) return;
		cpuAvailable = wantCpu;
		gpuAvailable = wantGpu;
		thread = new Thread(() -> run(wantCpu, wantGpu), "ReminthHUD system load");
		thread.setDaemon(true);
		// Below the game's own threads: a busy PC should drop a reading, not a frame.
		thread.setPriority(Thread.MIN_PRIORITY);
		thread.start();
	}

	static synchronized void stop() {
		if (thread != null) thread.interrupt();
	}

	private static void run(boolean wantCpu, boolean wantGpu) {
		com.sun.management.OperatingSystemMXBean os = null;
		if (wantCpu) {
			try {
				os = ManagementFactory.getPlatformMXBean(com.sun.management.OperatingSystemMXBean.class);
			} catch (Throwable t) {
				ReminthHud.LOGGER.info("ReminthHUD: CPU load isn't available here ({}), leaving it out", t.toString());
				cpuAvailable = false;
			}
		}
		GpuCounter gpu = null;
		if (wantGpu) {
			try {
				gpu = GpuCounter.open();
			} catch (Throwable t) {
				ReminthHud.LOGGER.info("ReminthHUD: GPU load isn't available here ({}), leaving it out", t.toString());
				gpuAvailable = false;
			}
		}
		// The mean of the last three readings, so the number doesn't jump around.
		int[] cpuLast = new int[3];
		int cpuN = 0;
		try {
			while (!Thread.currentThread().isInterrupted()) {
				if (os != null) {
					double load = os.getCpuLoad();
					if (load >= 0) {
						cpuLast[cpuN % 3] = (int) Math.round(load * 100);
						cpuN++;
						int k = Math.min(cpuN, 3);
						int sum = 0;
						for (int i = 0; i < k; i++) sum += cpuLast[i];
						cpuPercent = Math.round((float) sum / k);
					}
				}
				if (gpu != null) {
					try {
						int g = gpu.sample();
						if (g >= 0) gpuPercent = g;
					} catch (Throwable t) {
						ReminthHud.LOGGER.info("ReminthHUD: GPU load stopped working ({}), leaving it out", t.toString());
						gpuAvailable = false;
						gpu.close();
						gpu = null;
					}
				}
				Thread.sleep(1000);
			}
		} catch (InterruptedException e) {
			// the game is closing
		} finally {
			if (gpu != null) gpu.close();
		}
	}
}
