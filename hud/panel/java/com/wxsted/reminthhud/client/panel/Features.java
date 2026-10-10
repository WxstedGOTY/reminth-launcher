package com.wxsted.reminthhud.client.panel;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/**
 * The first 15 features (docs/PANEL_FEATURES.md): FPS, Ping, CPS, Keystrokes, Coordinates, Clock, Armor status, Held
 * item durability, Potion effects, Totem counter, Hurt cam, Low fire, Toggle sprint, Toggle sneak, Zoom. Nothing here
 * plays for you or shows what you couldn't see anyway.
 */
public final class Features {
	private Features() {
	}

	public static List<Module> all() {
		List<Module> list = new ArrayList<>();
		list.add(new Fps());
		list.add(new Ping());
		list.add(new Cps());
		list.add(new Keystrokes());
		list.add(new Coords());
		list.add(new Clock());
		list.add(new ArmorStatus());
		list.add(new HeldDurability());
		list.add(new PotionEffects());
		list.add(new TotemCounter());
		list.add(new Zoom());
		list.add(new HurtCam());
		list.add(new LowFire());
		list.add(new ToggleSprint());
		list.add(new ToggleSneak());
		list.addAll(Features2.all());
		list.addAll(Features3.all());
		list.add(new TierTagger());
		list.addAll(Features4.all());
		list.addAll(Features5.all());
		list.add(new ChatHooks.Mention());
		list.add(new ChatHooks.Highlight());
		list.add(new ChatHooks.ChatLog());
		list.add(new PanelLook());
		return list;
	}

	/* ------------------------------ HUD: text ------------------------------ */

	static final class Fps extends TextHud {
		Fps() {
			super("fps", "FPS", "fps", "Frames per second.", true, Anchor.LEFT, 4, -40);
		}

		@Override
		protected String label(Minecraft mc) {
			return "FPS";
		}

		@Override
		protected String value(Minecraft mc, boolean preview) {
			return Integer.toString(mc.getFps());
		}
	}

	static final class Ping extends TextHud {
		Ping() {
			super("ping", "Ping", "ping", "Your ping to the server, coloured by how good it is.", false, Anchor.LEFT, 4, -22);
		}

		@Override
		protected String label(Minecraft mc) {
			return "Ping";
		}

		@Override
		protected String value(Minecraft mc, boolean preview) {
			int p = PingMeter.ms(mc);
			if (p < 0) return preview ? "42 ms" : null;
			return p + " ms";
		}

		@Override
		public void tick(Minecraft mc) {
			PingMeter.tick(mc);
		}

		static int latency(Minecraft mc) {
			if (mc.player == null) return -1;
			ClientPacketListener c = mc.getConnection();
			if (c == null) return -1;
			PlayerInfo info = c.getPlayerInfo(mc.player.getUUID());
			return info == null ? -1 : Math.max(0, info.getLatency());
		}
	}

	static final class Cps extends TextHud {
		private final ArrayDeque<Long> left = new ArrayDeque<>();
		private final ArrayDeque<Long> right = new ArrayDeque<>();
		private boolean wasLeft, wasRight;
		private final Opt.Bool showRight = opt(new Opt.Bool("right", "Show right clicks too", true));

		Cps() {
			super("cps", "CPS", "cps", "Your clicks per second (left and right).", false, Anchor.LEFT, 4, -4);
		}

		/** Counted every frame from the game's own attack/use keys (works for mouse and rebound keys). */
		void count(Minecraft mc) {
			long now = System.currentTimeMillis();
			boolean l = mc.options.keyAttack.isDown(), r = mc.options.keyUse.isDown();
			if (l && !wasLeft) left.addLast(now);
			if (r && !wasRight) right.addLast(now);
			wasLeft = l;
			wasRight = r;
			while (!left.isEmpty() && now - left.peekFirst() > 1000) left.removeFirst();
			while (!right.isEmpty() && now - right.peekFirst() > 1000) right.removeFirst();
		}

		@Override
		protected String label(Minecraft mc) {
			return "CPS";
		}

		@Override
		protected String value(Minecraft mc, boolean preview) {
			count(mc);
			return showRight.value ? left.size() + " | " + right.size() : Integer.toString(left.size());
		}
	}

	static final class Coords extends TextHud {
		private final Opt.Bool facing = opt(new Opt.Bool("facing", "Show facing", true));

		Coords() {
			super("coords", "Coordinates", "coordinates", "Your X Y Z position and which way you face.", false, Anchor.LEFT, 4, 14);
		}

		@Override
		protected String label(Minecraft mc) {
			return "XYZ";
		}

		@Override
		protected String value(Minecraft mc, boolean preview) {
			if (mc.player == null) return preview ? "120 64 -340 N" : null;
			var p = mc.player.blockPosition();
			String s = p.getX() + " " + p.getY() + " " + p.getZ();
			if (facing.value) s += " " + mc.player.getDirection().getName().substring(0, 1).toUpperCase(Locale.ROOT);
			return s;
		}
	}

	static final class Clock extends TextHud {
		private final Opt.Choice format = opt(new Opt.Choice("format", "Format", 0, "24 hour", "12 hour"));
		private final Opt.Bool seconds = opt(new Opt.Bool("seconds", "Seconds", false));
		private final Opt.Bool blink = opt(new Opt.Bool("blink", "Blinking colon", false));

		Clock() {
			super("clock", "Clock", "clock", "Your computer's time.", false, Anchor.TOP_RIGHT, -60, 4);
		}

		@Override
		protected String label(Minecraft mc) {
			return "";
		}

		@Override
		protected String value(Minecraft mc, boolean preview) {
			String p = format.value == 0 ? (seconds.value ? "HH:mm:ss" : "HH:mm") : (seconds.value ? "h:mm:ss a" : "h:mm a");
			String t = LocalTime.now().format(DateTimeFormatter.ofPattern(p, Locale.ROOT));
			return blink.value && (System.currentTimeMillis() / 500) % 2 == 1 ? t.replace(':', ' ') : t;
		}
	}

	static final class TotemCounter extends Module {
		private final Opt.Bool hideNone = opt(new Opt.Bool("hideNone", "Hide when you have none", true));
		private final Opt.Bool background = opt(new Opt.Bool("background", "Background", true));

		TotemCounter() {
			super("totems", "Totem Counter", Cat.HUD, "totem", "How many totems of undying you carry.", false, false, Anchor.BOTTOM, 98, -38);
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			int n = 0;
			if (mc.player != null) {
				var inv = mc.player.getInventory();
				for (int i = 0; i < inv.getContainerSize(); i++) {
					ItemStack s = inv.getItem(i);
					if (s.is(Items.TOTEM_OF_UNDYING)) n += s.getCount();
				}
			}
			if (preview && n == 0) n = 3;
			if (n == 0 && hideNone.value && !preview) return;
			String t = "x" + n;
			int w = 20 + Draw.font().width(t) + 4, h = 20;
			if (background.value) Draw.round(g, 0, 0, w, h, 3, 0x73000000);
			g.item(new ItemStack(Items.TOTEM_OF_UNDYING), 2, 2);
			g.text(Draw.font(), t, 20, 6, n == 0 ? 0xFFFF5555 : 0xFFFFFFFF, true);
			lastW = w;
			lastH = h;
		}
	}

	/* ------------------------------ HUD: drawn ------------------------------ */

	static final class Keystrokes extends Module {
		private final Opt.Bool mouse = opt(new Opt.Bool("mouse", "Mouse buttons", true));
		private final Opt.Bool space = opt(new Opt.Bool("space", "Space bar", true));
		private final Opt.Color pressed = opt(new Opt.Color("pressed", "Pressed colour", 0xFFFFFFFF));

		Keystrokes() {
			super("keystrokes", "Keystrokes", Cat.HUD, "keystrokes", "W A S D, space and mouse buttons light up as you press them.", false, false, Anchor.TOP_RIGHT, -70, 20);
		}

		private void key(Gfx g, int x, int y, int w, int h, String label, boolean down) {
			Draw.round(g, x, y, w, h, 3, down ? (pressed.value & 0x00FFFFFF) | 0xD0000000 : 0x8C000000);
			int c = down ? 0xFF000000 : 0xFFFFFFFF;
			g.text(Draw.font(), label, x + (w - Draw.font().width(label)) / 2, y + (h - 8) / 2, c, false);
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			var o = mc.options;
			int k = 20, gap = 2;
			key(g, k + gap, 0, k, k, "W", o.keyUp.isDown());
			key(g, 0, k + gap, k, k, "A", o.keyLeft.isDown());
			key(g, k + gap, k + gap, k, k, "S", o.keyDown.isDown());
			key(g, 2 * (k + gap), k + gap, k, k, "D", o.keyRight.isDown());
			int y = 2 * (k + gap);
			int full = 3 * k + 2 * gap;
			if (mouse.value) {
				int half = (full - gap) / 2;
				key(g, 0, y, half, 14, "LMB", o.keyAttack.isDown());
				key(g, half + gap, y, full - half - gap, 14, "RMB", o.keyUse.isDown());
				y += 14 + gap;
			}
			if (space.value) {
				key(g, 0, y, full, 9, "", o.keyJump.isDown());
				y += 9;
			}
			lastW = full;
			lastH = y;
		}
	}

	static final class ArmorStatus extends Module {
		private final Opt.Choice layout = opt(new Opt.Choice("layout", "Layout", 0, "In a row", "In a column"));
		private final Opt.Bool numbers = opt(new Opt.Bool("numbers", "Durability numbers", false));

		ArmorStatus() {
			super("armor", "Armor Status", Cat.HUD, "armor", "Your armor and how worn it is, left of the hotbar.", false, true, Anchor.BOTTOM, -91 - 6 - 72, -19);
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			List<ItemStack> items = new ArrayList<>();
			if (mc.player != null) {
				for (EquipmentSlot s : new EquipmentSlot[] {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET}) {
					ItemStack st = mc.player.getItemBySlot(s);
					if (!st.isEmpty()) items.add(st);
				}
			}
			if (items.isEmpty() && preview) {
				items.add(withDamage(new ItemStack(Items.DIAMOND_HELMET), 0.2f));
				items.add(withDamage(new ItemStack(Items.DIAMOND_CHESTPLATE), 0.6f));
				items.add(withDamage(new ItemStack(Items.DIAMOND_LEGGINGS), 0.1f));
				items.add(withDamage(new ItemStack(Items.DIAMOND_BOOTS), 0.85f));
			}
			if (items.isEmpty()) return;
			boolean row = layout.value == 0;
			int x = 0, y = 0, maxW = 0;
			for (ItemStack st : items) {
				g.item(st, x, y);
				g.itemDecorations(Draw.font(), st, x, y);
				int w = 18;
				if (numbers.value && st.isDamageableItem()) {
					String t = Integer.toString(st.getMaxDamage() - st.getDamageValue());
					if (row) {
						Draw.text(g, t, x + 9 - Draw.font().width(t) * 0.35f, y + 17, 0.7f, 0xFFFFFFFF, true);
					} else {
						g.text(Draw.font(), t, x + 18, y + 4, 0xFFFFFFFF, true);
						w = 18 + Draw.font().width(t) + 2;
					}
				}
				maxW = Math.max(maxW, row ? x + 18 : w);
				if (row) x += 18;
				else y += 18;
			}
			lastW = row ? x : maxW;
			lastH = row ? (numbers.value ? 24 : 16) : y;
		}
	}

	static ItemStack withDamage(ItemStack st, float worn) {
		if (st.isDamageableItem()) st.setDamageValue(Math.round(st.getMaxDamage() * worn));
		return st;
	}

	static final class HeldDurability extends Module {
		private final Opt.Bool offhand = opt(new Opt.Bool("offhand", "Off-hand item too", true));
		private final Opt.Bool percent = opt(new Opt.Bool("percent", "Show as %", false));

		HeldDurability() {
			super("durability", "Held Item Durability", Cat.HUD, "durability", "How much durability the item in your hand has left, left of the hotbar.", false, true, Anchor.BOTTOM, -91 - 6 - 72, -40);
		}

		private int line(Gfx g, ItemStack st, int y) {
			g.item(st, 0, y);
			int left = st.getMaxDamage() - st.getDamageValue();
			String t = percent.value ? Math.round(100f * left / Math.max(1, st.getMaxDamage())) + "%" : Integer.toString(left);
			float f = left / (float) Math.max(1, st.getMaxDamage());
			int c = f > 0.5f ? 0xFF55FF55 : f > 0.2f ? 0xFFFFFF55 : 0xFFFF5555;
			g.text(Draw.font(), t, 19, y + 4, c, true);
			return 19 + Draw.font().width(t);
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			List<ItemStack> items = new ArrayList<>();
			if (mc.player != null) {
				if (mc.player.getMainHandItem().isDamageableItem()) items.add(mc.player.getMainHandItem());
				if (offhand.value && mc.player.getOffhandItem().isDamageableItem()) items.add(mc.player.getOffhandItem());
			}
			if (items.isEmpty() && preview) items.add(withDamage(new ItemStack(Items.DIAMOND_SWORD), 0.35f));
			if (items.isEmpty()) return;
			int y = 0, w = 0;
			for (ItemStack st : items) {
				w = Math.max(w, line(g, st, y));
				y += 18;
			}
			lastW = w;
			lastH = y - 2;
		}
	}

	/**
	 * Potion Effects: the level (II, IV...) and the time left drawn ON the game's own effect icons in the top-right corner
	 * (owner, 8 Oct: no second list). Drawn right after the game draws its icons (mixin/EffectIconMixin), at the same
	 * places the game uses: 25 px apart from the right edge, good effects on the top row, bad ones 26 px lower.
	 */
	public static final class PotionEffects extends Module {
		private final Opt.Bool level = opt(new Opt.Bool("level", "Level (II, IV...)", true));
		private final Opt.Bool levelOne = opt(new Opt.Bool("levelOne", "Show level I too", false));
		private final Opt.Bool time = opt(new Opt.Bool("time", "Time left", true));
		private final Opt.Bool blink = opt(new Opt.Bool("blink", "Red when ending", true));

		PotionEffects() {
			super("effects", "Potion Effects", Cat.HUD, "potion", "The exact level and the time left, right on the game's own effect icons.", false, true, null, 0, 0);
		}

		private static String roman(int n) {
			String[] r = {"", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"};
			return n >= 1 && n <= 10 ? r[n] : Integer.toString(n);
		}

		/** Called after the game drew its effect icons. */
		public void drawOnIcons(Gfx g, Minecraft mc) {
			if (!enabled || mc.player == null || Panel.hudHidden) return;
			if (V.screenShowsEffects(mc)) return; // the game draws none then either
			var effects = mc.player.getActiveEffects();
			if (effects.isEmpty()) return;
			// text in whole screen pixels: about 0.6 of the normal size, rounded to the GUI scale
			double gs = Math.max(1, mc.getWindow().getGuiScale());
			float sc = (float) (Math.max(1, Math.round(0.6 * gs)) / gs);
			var font = Draw.font();
			int good = 0, bad = 0;
			for (MobEffectInstance e : com.google.common.collect.Ordering.natural().reverse().sortedCopy(effects)) {
				if (!e.showIcon()) continue;
				int x = g.guiWidth(), y = 1;
				if (mc.isDemo()) y += 15;
				if (V.beneficial(e)) {
					good++;
					x -= 25 * good;
				} else {
					bad++;
					x -= 25 * bad;
					y += 26;
				}
				int amp = e.getAmplifier() + 1;
				if (level.value && (amp > 1 || levelOne.value)) {
					String l = roman(amp);
					Draw.text(g, l, x + 23 - font.width(l) * sc, y + 1, sc, 0xFFFFFFFF, true);
				}
				if (time.value) {
					String t;
					if (e.isInfiniteDuration()) t = "\u221E";
					else {
						int sec = e.getDuration() / 20;
						t = sec >= 6000 ? (sec / 3600) + "h" : String.format(Locale.ROOT, "%d:%02d", sec / 60, sec % 60);
					}
					boolean ending = !e.isInfiniteDuration() && e.getDuration() < 200;
					int c = ending && blink.value ? 0xFFFF5555 : 0xFFFFFFFF;
					Draw.text(g, t, x + 12 - font.width(t) * sc / 2f, y + 23 - 8 * sc, sc, c, true);
				}
			}
		}
	}

	/* ------------------------------ Visual / Mechanic ------------------------------ */

	/** Zoom: hold the zoom key; scroll to zoom further. The FOV change is in mixin/CameraFovMixin. */
	public static final class Zoom extends Module {
		public final Opt.Num amount = opt(new Opt.Num("amount", "Zoom", 2, 10, 0.5, 4, "x"));
		public final Opt.Bool scroll = opt(new Opt.Bool("scroll", "Scroll to zoom more", true));
		public final Opt.Bool smooth = opt(new Opt.Bool("smooth", "Smooth camera while zoomed", true));
		public double extra = 1; // from scrolling, reset on release
		private boolean wasZooming;
		private boolean smoothBefore;

		Zoom() {
			super("zoom", "Zoom", Cat.VISUAL, "zoom", "Hold C (change it in Controls) to zoom in. Scroll to zoom more.", false, true, null, 0, 0);
		}

		public boolean zooming(Minecraft mc) {
			return enabled && V.screen(mc) == null && Panel.zoomKey() != null && Panel.zoomKey().isDown();
		}

		public double factor() {
			return Math.max(1, amount.value * extra);
		}

		@Override
		public void tick(Minecraft mc) {
			boolean z = zooming(mc);
			if (z && !wasZooming) {
				smoothBefore = mc.options.smoothCamera;
				if (smooth.value) mc.options.smoothCamera = true;
			} else if (!z && wasZooming) {
				mc.options.smoothCamera = smoothBefore;
				extra = 1;
			}
			wasZooming = z;
		}

		@Override
		public void onDisable(Minecraft mc) {
			if (wasZooming) mc.options.smoothCamera = smoothBefore;
			wasZooming = false;
			extra = 1;
		}
	}

	/** Hurt cam: how much the screen tilts when you are hit (the game's own Damage Tilt setting). */
	static final class HurtCam extends Module {
		private final Opt.Num strength = opt(new Opt.Num("strength", "Shake", 0, 100, 5, 25, "%"));
		private Double before;

		HurtCam() {
			super("hurtcam", "Hurt Cam", Cat.VISUAL, "hurtcam", "Less screen shake when you take damage.", false, true, null, 0, 0);
		}

		@Override
		public void onEnable(Minecraft mc) {
			if (before == null) before = mc.options.damageTiltStrength().get();
			apply(mc);
		}

		@Override
		public void tick(Minecraft mc) {
			apply(mc);
		}

		private void apply(Minecraft mc) {
			double want = strength.value / 100.0;
			if (Math.abs(mc.options.damageTiltStrength().get() - want) > 0.001) mc.options.damageTiltStrength().set(want);
		}

		@Override
		public void onDisable(Minecraft mc) {
			if (before != null) mc.options.damageTiltStrength().set(before);
			before = null;
		}
	}

	/** Low fire: the fire on your screen sits lower (mixin/FireOverlayMixin moves it). */
	public static final class LowFire extends Module {
		public final Opt.Num height = opt(new Opt.Num("height", "Lower by", 0, 60, 5, 30, "%"));

		LowFire() {
			super("lowfire", "Low Fire", Cat.VISUAL, "lowfire", "The fire on your screen sits lower so you can see.", false, true, null, 0, 0);
		}
	}

	/** Toggle sprint: the game's own "Sprint: Toggle" setting while this is on. */
	static final class ToggleSprint extends Module {
		private Boolean before;

		ToggleSprint() {
			super("togglesprint", "Toggle Sprint", Cat.MECHANIC, "sprint", "Press sprint once to keep sprinting (the game's own toggle).", false, false, null, 0, 0);
		}

		@Override
		public void onEnable(Minecraft mc) {
			if (before == null) before = mc.options.toggleSprint().get();
			mc.options.toggleSprint().set(true);
		}

		@Override
		public void onDisable(Minecraft mc) {
			if (before != null) mc.options.toggleSprint().set(before);
			before = null;
		}
	}

	/** Toggle sneak: the game's own "Sneak: Toggle" setting while this is on. */
	static final class ToggleSneak extends Module {
		private Boolean before;

		ToggleSneak() {
			super("togglesneak", "Toggle Sneak", Cat.MECHANIC, "sneak", "Press sneak once to keep sneaking (the game's own toggle).", false, false, null, 0, 0);
		}

		@Override
		public void onEnable(Minecraft mc) {
			if (before == null) before = mc.options.toggleCrouch().get();
			mc.options.toggleCrouch().set(true);
		}

		@Override
		public void onDisable(Minecraft mc) {
			if (before != null) mc.options.toggleCrouch().set(before);
			before = null;
		}
	}
}
