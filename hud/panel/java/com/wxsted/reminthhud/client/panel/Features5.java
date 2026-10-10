package com.wxsted.reminthhud.client.panel;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import net.minecraft.ChatFormatting;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;

/**
 * Batch 5 (10 Oct 2026, owner: "make it streamer friendly"): the Streamer category. Your own texts on screen (Stream
 * Text, eight of them), a LIVE / REC badge, timers, a Be Right Back screen, a facecam frame, a goal bar, a news ticker,
 * your socials in turn, cinematic bars, a grid and a border, a key-press display for tutorials, session counters and
 * Streamer Mode, which hides your coordinates and the server's address.
 */
public final class Features5 {
	private Features5() {
	}

	static List<Module> all() {
		List<Module> l = new ArrayList<>();
		l.addAll(StreamText.all());
		l.add(new LiveBadge());
		l.add(new StreamerMode());
		l.add(new Brb());
		l.add(new Facecam());
		l.add(new GoalBar());
		l.add(new Ticker());
		l.add(new Socials());
		l.add(new KeyPresses());
		Module.Anchor TL = Module.Anchor.TOP_LEFT, TR = Module.Anchor.TOP_RIGHT;
		l.add(new Timer("streamuptime", "Stream Timer", "hourglass", "How long you've been live: starts when you switch it on.", "LIVE", TL, 8, 4, 0));
		l.add(new Timer("stopwatch", "Stopwatch", "stopwatch", "A stopwatch: starts when you switch it on, switch it off and on to start again.", "", TR, -70, 4, 1));
		l.add(new Timer("countdown", "Countdown", "countdown", "Counts down from the minutes you pick (\"Starting soon\"), then shows your own text.", "Starting in", Module.Anchor.TOP, -40, 40, 2));
		l.add(text("deaths", "Death Counter", "skull", "How many times you died this session.", "Deaths", TL, 8, 60, (mc, p) -> Integer.toString(deaths)));
		l.add(text("kills", "Kill Counter", "kills", "Players and mobs you finished off this session.", "Kills", TL, 8, 78, (mc, p) -> Integer.toString(Features3.HitTracker.kills)));
		l.add(text("chatcount", "Chat Counter", "chat_lines", "How many chat messages came in this session.", "Messages", TL, 8, 96, (mc, p) -> {
			Module m = Panel.byId("chatcount");
			return m instanceof StatLine c ? Integer.toString(c.count) : "0";
		}));
		l.add(new CinemaBars());
		l.add(new Grid());
		l.add(new ScreenBorder());
		return l;
	}

	/* ------------------------------ helpers ------------------------------ */

	/** A one-line text display in the Streamer category. */
	static final class StatLine extends TextHud {
		int count;
		private final Features2.Line.Value v;

		StatLine(String id, String name, String icon, String desc, String label, Module.Anchor a, int dx, int dy, Features2.Line.Value v) {
			super(id, name, Cat.STREAM, icon, desc, false, a, dx, dy);
			this.v = v;
			this.lbl = label;
		}

		private final String lbl;

		@Override
		protected String label(Minecraft mc) {
			return lbl;
		}

		@Override
		protected String value(Minecraft mc, boolean preview) {
			String s = mc.player == null ? null : v.get(mc, preview);
			return s == null && preview ? v.get(null, true) : s;
		}
	}

	static Module text(String id, String name, String icon, String desc, String label, Module.Anchor a, int dx, int dy, Features2.Line.Value v) {
		return new StatLine(id, name, icon, desc, label, a, dx, dy, v);
	}

	static int deaths;
	private static boolean wasDead;
	private static String lastServer = "";

	/** Called every tick (Panel): deaths, session changes and the streamer keys. */
	static void tick(Minecraft mc) {
		StreamKeys.tick(mc);
		if (mc.player == null) return;
		String srv = mc.getCurrentServer() == null ? "sp" : mc.getCurrentServer().ip;
		if (!srv.equals(lastServer)) {
			lastServer = srv;
			deaths = 0;
			if (Panel.byId("chatcount") instanceof StatLine c) c.count = 0;
		}
		boolean dead = mc.player.isDeadOrDying();
		if (dead && !wasDead) deaths++;
		wasDead = dead;
	}

	/** Streamer Mode: these displays show "Hidden" instead of their value. */
	static boolean hides(Module m) {
		Module sm = Panel.byId("streamermode");
		return sm instanceof StreamerMode s && s.enabled && s.hides(m.id);
	}

	/* ------------------------------ modules ------------------------------ */

	static final class StreamerMode extends Module {
		private final Opt.Bool coords = opt(new Opt.Bool("coords", "Hide coordinates (and nether, chunk, death point...)", true));
		private final Opt.Bool server = opt(new Opt.Bool("server", "Hide the server address and name", true));
		private final Opt.Bool biome = opt(new Opt.Bool("biome", "Hide the biome", false));
		private final Opt.Bool reduced = opt(new Opt.Bool("reduced", "Less on the F3 screen (Reduced Debug Info)", true));
		private Boolean before;

		StreamerMode() {
			super("streamermode", "Streamer Mode", Cat.STREAM, "streamer", "Hides your coordinates and the server's address on Reminth's displays (and less on F3), so viewers can't find you.", true, false, null, 0, 0);
		}

		boolean hides(String id) {
			return switch (id) {
				case "coords", "nethercoords", "chunk", "death", "targetpos", "coordsbox", "sealevel" -> coords.value;
				case "serveraddr", "servername" -> server.value;
				case "biome" -> biome.value;
				default -> false;
			};
		}

		@Override
		public void onEnable(Minecraft mc) {
			if (reduced.value) {
				if (before == null) before = mc.options.reducedDebugInfo().get();
				mc.options.reducedDebugInfo().set(true);
			}
		}

		@Override
		public void onDisable(Minecraft mc) {
			if (before != null) mc.options.reducedDebugInfo().set(before);
			before = null;
		}
	}

	/** A red LIVE (or REC / ON AIR / your own word) badge with a blinking dot and the time since you switched it on. */
	static final class LiveBadge extends Module {
		private final Opt.Choice word = opt(new Opt.Choice("word", "Word", 0, "LIVE", "REC", "ON AIR", "Own word"));
		private final Opt.Text own = opt(new Opt.Text("own", "Own word", "STREAMING", 20));
		private final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFFFF5555));
		private final Opt.Bool dot = opt(new Opt.Bool("dot", "Blinking dot", true));
		private final Opt.Bool timer = opt(new Opt.Bool("timer", "Time since it was switched on", true));
		private final Opt.Bool filled = opt(new Opt.Bool("filled", "Filled badge", true));
		private long since = System.currentTimeMillis();

		LiveBadge() {
			super("live", "Live Badge", Cat.STREAM, "live", "A LIVE / REC / ON AIR badge with a blinking dot and how long you've been live.", true, false, Anchor.TOP_LEFT, 8, 8);
		}

		@Override
		public void onEnable(Minecraft mc) {
			since = System.currentTimeMillis();
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			String w = word.value == 3 ? own.value : word.shown();
			var font = Draw.font();
			var t = Component.literal(w).withStyle(ChatFormatting.BOLD);
			int x = 5;
			int wdt = font.width(t) + 10 + (dot.value ? 8 : 0);
			if (filled.value) Draw.round(g, 0, 0, wdt, 15, 3, color.value);
			else {
				Draw.round(g, 0, 0, wdt, 15, 3, 0x88000000);
				g.outline(0, 0, wdt, 15, color.value);
			}
			if (dot.value) {
				boolean on = (System.currentTimeMillis() / 600) % 2 == 0;
				Draw.round(g, x, 5, 5, 5, 2, on ? 0xFFFFFFFF : filled.value ? 0x66FFFFFF : 0x66000000);
				x += 8;
			}
			g.text(font, t, x, 4, filled.value ? 0xFFFFFFFF : color.value, filled.value);
			int total = wdt;
			if (timer.value) {
				long s = (System.currentTimeMillis() - since) / 1000;
				String tt = s >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60);
				int tw = font.width(tt) + 8;
				Draw.round(g, wdt + 2, 0, tw, 15, 3, 0x88000000);
				g.text(font, tt, wdt + 6, 4, 0xFFFFFFFF, true);
				total += 2 + tw;
			}
			lastW = total;
			lastH = 15;
		}
	}

	/** Stream timer, stopwatch and countdown: kind 0, 1, 2. */
	static final class Timer extends TextHud {
		private final int kind;
		private final String lbl;
		private final Opt.Num minutes;
		private final Opt.Text done;
		private final Opt.Bool tenths;
		private long since = System.currentTimeMillis();

		Timer(String id, String name, String icon, String desc, String label, Anchor a, int dx, int dy, int kind) {
			super(id, name, Cat.STREAM, icon, desc, false, a, dx, dy);
			this.kind = kind;
			this.lbl = label;
			this.minutes = kind == 2 ? opt(new Opt.Num("minutes", "Minutes", 1, 120, 1, 5, " min")) : null;
			this.done = kind == 2 ? opt(new Opt.Text("done", "Text when it's done", "Starting now!", 40)) : null;
			this.tenths = kind == 1 ? opt(new Opt.Bool("tenths", "Tenths of a second", true)) : null;
		}

		@Override
		public void onEnable(Minecraft mc) {
			since = System.currentTimeMillis();
		}

		@Override
		protected String label(Minecraft mc) {
			return kind == 2 && left() <= 0 ? "" : lbl;
		}

		private long left() {
			return minutes == null ? 0 : (long) (minutes.value * 60000) - (System.currentTimeMillis() - since);
		}

		@Override
		protected String value(Minecraft mc, boolean preview) {
			long ms = kind == 2 ? left() : System.currentTimeMillis() - since;
			if (kind == 2 && ms <= 0) return done.value;
			long s = ms / 1000;
			String t = s >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60);
			if (tenths != null && tenths.value) t += "." + (ms / 100 % 10);
			return t;
		}
	}

	/** Be Right Back: covers the whole screen with your message (and a timer) until you switch it off or press its key. */
	static final class Brb extends Module implements Overlay {
		private final Opt.Text title = opt(new Opt.Text("title", "Big text", "BE RIGHT BACK", 40));
		private final Opt.Text sub = opt(new Opt.Text("sub", "Small text", "Stay tuned!", 60));
		private final Opt.Num titleSize = opt(new Opt.Num("titleSize", "Big text size", 1, 8, 0.5, 4, "x"));
		private final Opt.Color textColor = opt(new Opt.Color("textColor", "Text colour", 0xFFFFFFFF));
		private final Opt.Bool rainbow = opt(new Opt.Bool("rainbow", "Rainbow big text", false));
		private final Opt.Color bg = opt(new Opt.Color("bg", "Background colour", 0xFF000000));
		private final Opt.Num bgOpacity = opt(new Opt.Num("bgOpacity", "Background opacity", 30, 100, 5, 85, "%"));
		private final Opt.Bool timer = opt(new Opt.Bool("timer", "Time away", true));
		private final Opt.Bool dots = opt(new Opt.Bool("dots", "Moving dots", true));
		private long since = System.currentTimeMillis();

		Brb() {
			super("brb", "Be Right Back Screen", Cat.STREAM, "brb", "Covers the screen with \"Be right back\" and how long you've been away. Set a key for it in Controls.", true, false, null, 0, 0);
		}

		@Override
		public void onEnable(Minecraft mc) {
			since = System.currentTimeMillis();
		}

		@Override
		public boolean onTop() {
			return true;
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			int w = g.guiWidth(), h = g.guiHeight();
			g.fill(0, 0, w, h, Draw.alpha(bg.value, bgOpacity.value / 100.0));
			float ts = (float) titleSize.value;
			String t = title.value + (dots.value ? ".".repeat((int) (System.currentTimeMillis() / 500 % 4)) : "");
			int c = rainbow.value ? Draw.rainbow(0.2f, 0) : textColor.value;
			var comp = Component.literal(t).withStyle(ChatFormatting.BOLD);
			float tw = Draw.font().width(Component.literal(title.value + "...").withStyle(ChatFormatting.BOLD)) * ts;
			Draw.text(g, comp, w / 2f - tw / 2f, h / 2f - 9 * ts, ts, c, true);
			Draw.centered(g, sub.value, w / 2f, h / 2f + 6, 1.5f, Draw.alpha(textColor.value, 0.8));
			if (timer.value) {
				long s = (System.currentTimeMillis() - since) / 1000;
				Draw.centered(g, String.format(Locale.ROOT, "Away for %d:%02d", s / 60, s % 60), w / 2f, h / 2f + 24, 1f, Draw.alpha(textColor.value, 0.6));
			}
		}
	}

	/** A frame for your facecam: a box (or just its corners) with a name tag. */
	static final class Facecam extends Module {
		private final Opt.Num fw = opt(new Opt.Num("w", "Width", 40, 300, 5, 120, ""));
		private final Opt.Num fh = opt(new Opt.Num("h", "Height", 30, 300, 5, 90, ""));
		private final Opt.Choice style = opt(new Opt.Choice("style", "Style", 0, "Full frame", "Corners only", "Double frame"));
		private final Opt.Num thick = opt(new Opt.Num("thick", "Thickness", 1, 6, 1, 2, ""));
		private final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFFFFFFFF));
		private final Opt.Bool rainbow = opt(new Opt.Bool("rainbow", "Rainbow", false));
		private final Opt.Num fill = opt(new Opt.Num("fill", "Fill inside", 0, 100, 5, 0, "%"));
		private final Opt.Text name = opt(new Opt.Text("name", "Name tag", "", 30));

		Facecam() {
			super("facecam", "Facecam Frame", Cat.STREAM, "facecam", "A frame where your camera goes, so it doesn't cover anything important.", true, false, Anchor.BOTTOM_RIGHT, -130, -110);
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			int w = (int) fw.value, h = (int) fh.value, t = (int) thick.value;
			int c = rainbow.value ? Draw.rainbow(0.2f, 0) : color.value;
			if (fill.value > 0) g.fill(0, 0, w, h, Draw.alpha(0xFF000000, fill.value / 100.0));
			if (style.value == 1) {
				int k = Math.min(w, h) / 4;
				g.fill(0, 0, k, t, c);
				g.fill(0, 0, t, k, c);
				g.fill(w - k, 0, w, t, c);
				g.fill(w - t, 0, w, k, c);
				g.fill(0, h - t, k, h, c);
				g.fill(0, h - k, t, h, c);
				g.fill(w - k, h - t, w, h, c);
				g.fill(w - t, h - k, w, h, c);
			} else {
				frame(g, 0, 0, w, h, t, c);
				if (style.value == 2) frame(g, t + 2, t + 2, w - 2 * (t + 2), h - 2 * (t + 2), 1, Draw.alpha(c, 0.6));
			}
			if (!name.value.isEmpty()) {
				int nw = Draw.font().width(name.value) + 8;
				Draw.round(g, 4, h - 16, nw, 12, 2, c);
				g.text(Draw.font(), name.value, 8, h - 14, 0xFF000000 | (((c & 0xFFFFFF) == 0xFFFFFF) ? 0 : 0xFFFFFF), false);
			}
			lastW = w;
			lastH = h;
		}

		private static void frame(Gfx g, int x, int y, int w, int h, int t, int c) {
			g.fill(x, y, x + w, y + t, c);
			g.fill(x, y + h - t, x + w, y + h, c);
			g.fill(x, y, x + t, y + h, c);
			g.fill(x + w - t, y, x + w, y + h, c);
		}
	}

	/** A goal with a progress bar ("Followers 37 / 50"): the numbers are typed in its options. */
	static final class GoalBar extends Module {
		private final Opt.Text title = opt(new Opt.Text("title", "Title", "Follower goal", 40));
		private final Opt.Text now = opt(new Opt.Text("now", "Now", "37", 10));
		private final Opt.Text goal = opt(new Opt.Text("goal", "Goal", "50", 10));
		private final Opt.Num width = opt(new Opt.Num("width", "Bar width", 60, 300, 10, 140, ""));
		private final Opt.Color color = opt(new Opt.Color("color", "Bar colour", 0xFF55FF55));
		private final Opt.Bool rainbow = opt(new Opt.Bool("rainbow", "Rainbow bar", false));
		private final Opt.Choice numbers = opt(new Opt.Choice("numbers", "Numbers", 0, "37 / 50", "74%", "Both", "None"));

		GoalBar() {
			super("goalbar", "Goal Bar", Cat.STREAM, "goal", "A goal with a progress bar, like \"Follower goal 37 / 50\".", true, false, Anchor.TOP_LEFT, 8, 120);
		}

		private static double num(String s) {
			try {
				return Double.parseDouble(s.trim().replace(",", ""));
			} catch (NumberFormatException e) {
				return 0;
			}
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			double a = num(now.value), b = Math.max(1, num(goal.value));
			float f = (float) Math.max(0, Math.min(1, a / b));
			int w = (int) width.value;
			var font = Draw.font();
			Draw.round(g, 0, 0, w, 26, 3, 0x88000000);
			g.text(font, Draw.fit(title.value, w - 8, 1f), 4, 3, 0xFFFFFFFF, true);
			String n = switch (numbers.value) {
				case 1 -> Math.round(f * 100) + "%";
				case 2 -> now.value.trim() + " / " + goal.value.trim() + "  " + Math.round(f * 100) + "%";
				case 3 -> "";
				default -> now.value.trim() + " / " + goal.value.trim();
			};
			if (!n.isEmpty()) Draw.text(g, n, w - 4 - font.width(n) * 0.75f, 4, 0.75f, 0xFFDDDDDD, true);
			Draw.round(g, 4, 15, w - 8, 7, 3, 0x55FFFFFF);
			int bc = rainbow.value ? Draw.rainbow(0.25f, 0) : color.value;
			if (f > 0) Draw.round(g, 4, 15, Math.max(4, Math.round((w - 8) * f)), 7, 3, bc);
			lastW = w;
			lastH = 26;
		}
	}

	/** A bar across the top or bottom with your text scrolling through it, like news on TV. */
	static final class Ticker extends Module implements Overlay {
		private final Opt.Text text = opt(new Opt.Text("text", "Text", "Thanks for watching!  *  Follow for more  *  !discord in chat", 120));
		private final Opt.Choice where = opt(new Opt.Choice("where", "Where", 1, "Top", "Bottom (above the hotbar)", "Very bottom"));
		private final Opt.Num speed = opt(new Opt.Num("speed", "Speed", 0.2, 4, 0.1, 1, "x"));
		private final Opt.Color color = opt(new Opt.Color("color", "Text colour", 0xFFFFFFFF));
		private final Opt.Color bg = opt(new Opt.Color("bg", "Bar colour", 0xFF000000));
		private final Opt.Num opacity = opt(new Opt.Num("opacity", "Bar opacity", 0, 100, 5, 60, "%"));
		private final Opt.Num scale = opt(new Opt.Num("scale", "Text size", 0.5, 3, 0.25, 1, "x"));

		Ticker() {
			super("ticker", "News Ticker", Cat.STREAM, "ticker", "A bar with your text scrolling through it, like news on TV.", true, false, null, 0, 0);
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			int w = g.guiWidth(), h = g.guiHeight();
			float s = (float) scale.value;
			int bh = Math.round(12 * s);
			int y = switch (where.value) {
				case 0 -> 0;
				case 2 -> h - bh;
				default -> h - 50 - bh;
			};
			g.fill(0, y, w, y + bh, Draw.alpha(bg.value, opacity.value / 100.0));
			String t = text.value + "        ";
			float tw = Draw.font().width(t) * s;
			float off = (float) ((System.currentTimeMillis() / 1000.0 * 40 * speed.value) % Math.max(1, tw));
			g.enableScissor(0, y, w, y + bh);
			for (float x = -off; x < w; x += tw) Draw.text(g, t, x, y + 2 * s, s, color.value, true);
			g.disableScissor();
		}
	}

	/** Your socials (or any short texts) one after another, fading in and out. */
	static final class Socials extends Module {
		private final Opt.Text a = opt(new Opt.Text("a", "1", "twitch.tv/yourname", 40));
		private final Opt.Text b = opt(new Opt.Text("b", "2", "youtube.com/@yourname", 40));
		private final Opt.Text c = opt(new Opt.Text("c", "3", "x.com/yourname", 40));
		private final Opt.Text d = opt(new Opt.Text("d", "4", "", 40));
		private final Opt.Num seconds = opt(new Opt.Num("seconds", "Seconds each", 2, 30, 1, 5, " s"));
		private final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFFFFFFFF));
		private final Opt.Bool box = opt(new Opt.Bool("box", "Background", true));
		private final Opt.Bool fade = opt(new Opt.Bool("fade", "Fade", true));

		Socials() {
			super("socials", "Socials Rotator", Cat.STREAM, "socials", "Your socials (or any texts) one after another, fading in and out.", true, false, Anchor.BOTTOM_LEFT, 8, -40);
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			List<String> list = new ArrayList<>();
			for (Opt.Text t : new Opt.Text[] {a, b, c, d}) if (!t.value.isBlank()) list.add(t.value);
			if (list.isEmpty()) return;
			long per = (long) (seconds.value * 1000);
			long now = System.currentTimeMillis();
			String t = list.get((int) ((now / per) % list.size()));
			double in = (now % per) / (double) per;
			double alpha = fade.value ? Math.min(1, Math.min(in, 1 - in) * 6) : 1;
			int w = Draw.font().width(t) + 8;
			if (box.value) Draw.round(g, 0, 0, w, 15, 3, Draw.alpha(0xFF000000, 0.5 * alpha));
			g.text(Draw.font(), t, 4, 4, Draw.alpha(color.value, Math.max(0.05, alpha)), true);
			lastW = w;
			lastH = 15;
		}
	}

	/** Shows the game keys you hold right now ("W  Walk Forwards") - for tutorials and showing your controls. */
	static final class KeyPresses extends Module {
		private final Opt.Bool actions = opt(new Opt.Bool("actions", "Show what the key does", true));
		private final Opt.Num rows = opt(new Opt.Num("rows", "Most keys shown", 1, 10, 1, 6, ""));
		private final Opt.Color color = opt(new Opt.Color("color", "Key colour", 0xFFFFFFFF));

		KeyPresses() {
			super("keypresses", "Key Press Display", Cat.STREAM, "keyboard", "Shows the game keys you are holding, like \"W  Walk Forwards\" - great for tutorials.", true, false, Anchor.BOTTOM_LEFT, 8, -100);
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			List<String[]> held = new ArrayList<>();
			for (KeyMapping k : mc.options.keyMappings) {
				if (held.size() >= rows.value) break;
				if (k.isDown()) held.add(new String[] {k.getTranslatedKeyMessage().getString(), Component.translatable(k.getName()).getString()});
			}
			if (held.isEmpty() && preview) {
				held.add(new String[] {"W", "Walk Forwards"});
				held.add(new String[] {"Space", "Jump"});
			}
			var font = Draw.font();
			int y = 0, w = 0;
			for (String[] r : held) {
				int kw = font.width(r[0]) + 8;
				Draw.round(g, 0, y, kw, 13, 3, 0xAA000000);
				g.outline(0, y, kw, 13, Draw.alpha(color.value, 0.6));
				g.text(font, r[0], 4, y + 3, color.value, false);
				int tw = kw;
				if (actions.value) {
					g.text(font, r[1], kw + 4, y + 3, 0xFFDDDDDD, true);
					tw += 4 + font.width(r[1]);
				}
				w = Math.max(w, tw);
				y += 15;
			}
			lastW = Math.max(20, w);
			lastH = Math.max(10, y - 2);
		}
	}

	/** Black bars at the top and bottom, like a film. */
	static final class CinemaBars extends Module implements Overlay {
		private final Opt.Num size = opt(new Opt.Num("size", "Bar size", 2, 25, 1, 10, "%"));
		private final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFF000000));
		private final Opt.Num opacity = opt(new Opt.Num("opacity", "Opacity", 20, 100, 5, 100, "%"));

		CinemaBars() {
			super("cinemabars", "Cinematic Bars", Cat.STREAM, "cinema", "Black bars at the top and bottom of the screen, like a film (for recording).", true, false, null, 0, 0);
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			int w = g.guiWidth(), h = g.guiHeight(), b = (int) (h * size.value / 100);
			int c = Draw.alpha(color.value, opacity.value / 100.0);
			g.fill(0, 0, w, b, c);
			g.fill(0, h - b, w, h, c);
		}
	}

	/** Thin lines over the screen to line up a shot: thirds, quarters or a centre cross. */
	static final class Grid extends Module implements Overlay {
		private final Opt.Choice kind = opt(new Opt.Choice("kind", "Lines", 0, "Thirds", "Quarters", "Centre cross", "Thirds + centre"));
		private final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFFFFFFFF));
		private final Opt.Num opacity = opt(new Opt.Num("opacity", "Opacity", 10, 100, 5, 35, "%"));

		Grid() {
			super("grid", "Framing Grid", Cat.STREAM, "grid", "Thin lines to line up screenshots and recordings (rule of thirds).", true, false, null, 0, 0);
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			int w = g.guiWidth(), h = g.guiHeight();
			int c = Draw.alpha(color.value, opacity.value / 100.0);
			int n = kind.value == 1 ? 4 : 3;
			if (kind.value != 2) {
				for (int i = 1; i < n; i++) {
					g.fill(w * i / n, 0, w * i / n + 1, h, c);
					g.fill(0, h * i / n, w, h * i / n + 1, c);
				}
			}
			if (kind.value >= 2) {
				g.fill(w / 2 - 8, h / 2, w / 2 + 9, h / 2 + 1, c);
				g.fill(w / 2, h / 2 - 8, w / 2 + 1, h / 2 + 9, c);
			}
		}
	}

	/** A coloured (or rainbow) border around the whole screen. */
	static final class ScreenBorder extends Module implements Overlay {
		private final Opt.Num thick = opt(new Opt.Num("thick", "Thickness", 1, 12, 1, 3, ""));
		private final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFF5599FF));
		private final Opt.Bool rainbow = opt(new Opt.Bool("rainbow", "Rainbow", true));
		private final Opt.Num opacity = opt(new Opt.Num("opacity", "Opacity", 10, 100, 5, 80, "%"));

		ScreenBorder() {
			super("screenborder", "Screen Border", Cat.STREAM, "border", "A coloured or rainbow border around the screen.", true, false, null, 0, 0);
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			int w = g.guiWidth(), h = g.guiHeight(), t = (int) thick.value;
			int c = Draw.alpha(rainbow.value ? Draw.rainbow(0.15f, 0) : color.value, opacity.value / 100.0);
			int c2 = Draw.alpha(rainbow.value ? Draw.rainbow(0.15f, 0.5f) : color.value, opacity.value / 100.0);
			g.fill(0, 0, w, t, c);
			g.fill(0, h - t, w, h, c2);
			g.fill(0, t, t, h - t, c);
			g.fill(w - t, t, w, h - t, c2);
		}
	}
}
