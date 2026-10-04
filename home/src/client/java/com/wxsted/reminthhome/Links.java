package com.wxsted.reminthhome;

/** Opens a reminth:// link with the operating system (the game's own helper changed between versions). */
final class Links {
	private Links() {
	}

	/** Only ever called with a fixed reminth:// link, never with text from anywhere else. */
	static void open(String link) {
		if (!link.startsWith("reminth://")) return;
		try {
			String os = System.getProperty("os.name", "").toLowerCase(java.util.Locale.ROOT);
			ProcessBuilder pb;
			if (os.contains("win")) pb = new ProcessBuilder("rundll32", "url.dll,FileProtocolHandler", link);
			else if (os.contains("mac")) pb = new ProcessBuilder("open", link);
			else pb = new ProcessBuilder("xdg-open", link);
			pb.start();
		} catch (Throwable t) {
			// Reminth is not installed on this machine: nothing to open
		}
	}
}
