package com.wxsted.reminthhud.client.panel;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

import net.fabricmc.fabric.api.client.item.v1.ItemTooltipCallback;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.BowItem;
import net.minecraft.world.item.CrossbowItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;

/**
 * Batch 3 (8 Oct 2026), picked from the owner's ChatGPT list of 270: only features that show your own state or what
 * you can already see, change looks, or are the game's own settings. Left out from that list on purpose: inventory
 * sorting / moving items for you (DonutSMP and Hypixel ban it), minimaps and radar, schematics, drills, dummies and
 * replays (too big or need a server).
 */
public final class Features3 {
	private Features3() {
	}

	static List<Module> all() {
		List<Module> l = new ArrayList<>();
		Module.Anchor C = Module.Anchor.CENTER, L = Module.Anchor.LEFT;
		l.add(new AttackCharge());
		l.add(new BowDraw());
		l.add(line("crossbow", "Crossbow Loaded", "crossbow", "Whether the crossbow in your hand is loaded.", "", C, 12, 32, (mc, p) -> {
			ItemStack st = mc == null ? ItemStack.EMPTY : mc.player.getMainHandItem().is(Items.CROSSBOW) ? mc.player.getMainHandItem() : mc.player.getOffhandItem();
			if (!st.is(Items.CROSSBOW)) return p || mc == null ? "Crossbow loaded" : null;
			return CrossbowItem.isCharged(st) ? "Crossbow loaded" : "Crossbow empty";
		}));
		l.add(line("shieldup", "Shield Up", "shieldup", "Shows when your shield is raised.", "", C, -60, 32, (mc, p) -> mc == null || mc.player.isBlocking() ? "Shield up" : (p ? "Shield up" : null)));
		l.add(new OffhandTile());
		l.add(line("fall", "Fall Distance", "falldist", "How far you are falling right now.", "Fall", C, 12, 44, (mc, p) -> {
			double f = mc == null ? 12.4 : mc.player.fallDistance;
			if (f < 0.6) return p ? "12.4 blocks" : null;
			return String.format(Locale.ROOT, "%.1f blocks", f);
		}));
		l.add(line("heldfood", "Held Food", "heldfood", "How much hunger and saturation the food in your hand gives.", "Food", L, 4, 230, (mc, p) -> {
			if (mc == null) return "+4  sat +2.4";
			FoodProperties f = mc.player.getMainHandItem().get(DataComponents.FOOD);
			if (f == null) f = mc.player.getOffhandItem().get(DataComponents.FOOD);
			if (f == null) return p ? "+4  sat +2.4" : null;
			return "+" + f.nutrition() + "  sat +" + String.format(Locale.ROOT, "%.1f", f.saturation());
		}));
		l.add(new RightTool());
		l.add(line("lowesthp", "Lowest Health", "lowesthp", "The lowest your health got since you joined.", "Lowest", L, 4, 248, (mc, p) -> mc == null || lowest > 1000 ? "6.0 HP" : String.format(Locale.ROOT, "%.1f HP", lowest)));
		l.add(new LowAlert());
		l.add(new FoodStock());
		l.add(line("daynight", "Day / Night Timer", "daynight", "Real time left until night or until morning.", "", Module.Anchor.TOP_RIGHT, -110, 148, (mc, p) -> {
			long t = mc == null ? 9000 : mc.level.getOverworldClockTime() % 24000;
			boolean day = t < 12542;
			long left = day ? 12542 - t : 24000 - t;
			long s = left / 20;
			return (day ? "Night in " : "Day in ") + s / 60 + ":" + String.format(Locale.ROOT, "%02d", s % 60);
		}));
		l.add(line("sleep", "Sleep Cue", "bedcue", "Tells you when you can sleep in a bed.", "", Module.Anchor.TOP_RIGHT, -110, 166, (mc, p) -> {
			if (mc == null) return "You can sleep";
			long t = mc.level.getOverworldClockTime() % 24000;
			boolean can = (t >= 12542 && t <= 23459) || mc.level.isThundering();
			return can ? "You can sleep" : (p ? "You can sleep" : null);
		}));
		l.add(line("nethercoords", "Nether Coordinates", "nethercoords", "Where you'd be in the other dimension (x8 or /8).", "", L, 4, 266, (mc, p) -> {
			if (mc == null) return "Nether: 15 -42";
			String dim = mc.level.dimension().identifier().getPath();
			double x = mc.player.getX(), z = mc.player.getZ();
			if (dim.equals("the_nether")) return "Overworld: " + (int) Math.floor(x * 8) + " " + (int) Math.floor(z * 8);
			if (dim.equals("overworld")) return "Nether: " + (int) Math.floor(x / 8) + " " + (int) Math.floor(z / 8);
			return null;
		}));
		l.add(new FrameTime());
		l.add(line("damagetaken", "Damage Taken", "damagetaken", "How much health you just lost (only your own).", "", C, 12, 56, (mc, p) -> {
			if (mc != null && System.currentTimeMillis() - lastDamageAt < 4000) return String.format(Locale.ROOT, "-%.1f HP", lastDamage);
			return p || mc == null ? "-3.5 HP" : null;
		}));
		l.add(line("combo", "Combo Counter", "combo", "Your hits in a row (resets after 2 seconds without one).", "Combo", C, -60, 44, (mc, p) -> {
			if (mc != null && HitTracker.combo() > 0) return Integer.toString(HitTracker.combo());
			return p || mc == null ? "4" : null;
		}));
		l.add(new HitMarker());
		l.add(new HideHud());
		l.add(new BreakReminder());
		l.add(new TooltipDurability());
		l.add(new TooltipFood());
		l.add(new ChatTimestamps());
		Module.Cat U = Module.Cat.UTILITY, V = Module.Cat.VISUAL;
		Object[][] sounds = {
			{"vol_master", "Master Volume", SoundSource.MASTER, "vol_master"}, {"vol_music", "Music Volume", SoundSource.MUSIC, "vol_music"},
			{"vol_records", "Jukebox Volume", SoundSource.RECORDS, "vol_records"}, {"vol_weather", "Weather Volume", SoundSource.WEATHER, "vol_weather"},
			{"vol_blocks", "Blocks Volume", SoundSource.BLOCKS, "vol_blocks"}, {"vol_hostile", "Hostile Mobs Volume", SoundSource.HOSTILE, "vol_hostile"},
			{"vol_neutral", "Friendly Mobs Volume", SoundSource.NEUTRAL, "vol_neutral"}, {"vol_players", "Players Volume", SoundSource.PLAYERS, "vol_players"},
			{"vol_ambient", "Ambient Volume", SoundSource.AMBIENT, "vol_ambient"}, {"vol_voice", "Voice Volume", SoundSource.VOICE, "vol_voice"},
		};
		for (Object[] s : sounds) {
			SoundSource src = (SoundSource) s[2];
			l.add(OptionFeature.percent((String) s[0], (String) s[1], U, (String) s[3], "The game's " + ((String) s[1]).toLowerCase(Locale.ROOT) + ", kept with your profile.", o -> o.getSoundSourceOptionInstance(src), "Volume", 0, 100, 5, 100));
		}
		l.add(OptionFeature.percent("brightness", "Brightness", V, "brightness", "The game's brightness setting (Moody to Bright).", o -> o.gamma(), "Brightness", 0, 100, 5, 100));
		l.add(OptionFeature.integer("guiscale", "GUI Scale", V, "guiscale", "How big menus and the HUD are (0 = automatic).", o -> o.guiScale(), "Scale", 0, 6, 1, 0, ""));
		return l;
	}

	static Module line(String id, String name, String icon, String desc, String label, Module.Anchor a, int dx, int dy, Features2.Line.Value v) {
		Module m = new Features2.Line(id, name, icon, desc, label, a, dx, dy, v);
		return m;
	}

	/* ------------------------------ tracking ------------------------------ */

	static float lowest = Float.MAX_VALUE;
	static float lastHealth = -1, lastDamage;
	static long lastDamageAt;
	private static String lastSession = "";

	static void tick(Minecraft mc) {
		if (mc.player == null) {
			lastSession = "";
			return;
		}
		String session = mc.getCurrentServer() == null ? "sp" : mc.getCurrentServer().ip;
		if (!session.equals(lastSession)) {
			lastSession = session;
			lowest = Float.MAX_VALUE;
			lastHealth = -1;
		}
		float h = mc.player.getHealth();
		if (h > 0) lowest = Math.min(lowest, h);
		if (lastHealth >= 0 && h < lastHealth - 0.01f) {
			lastDamage = lastHealth - h;
			lastDamageAt = System.currentTimeMillis();
		}
		lastHealth = h;
		HitTracker.tick(mc);
	}

	/** Your own attacks (from mixin/AttackMixin) and whether the game showed them landing. */
	public static final class HitTracker {
		private HitTracker() {
		}

		private static Entity target;
		private static boolean crit;
		private static int wait;
		private static long lastHitAt;
		private static int combo;
		static long markAt;
		static int markKind; // 0 hit, 1 crit, 2 kill

		/** The player attacked this entity (before the game sends it). */
		public static void onAttack(Minecraft mc, Entity e) {
			if (mc.player == null) return;
			var p = mc.player;
			crit = p.fallDistance > 0 && !p.onGround() && !p.onClimbable() && !p.isInWater() && !p.isPassenger() && !p.isSprinting() && p.getAttackStrengthScale(0.5f) > 0.9f;
			target = e;
			wait = 8;
		}

		static void tick(Minecraft mc) {
			if (combo > 0 && System.currentTimeMillis() - lastHitAt > 2000) combo = 0;
			if (target == null) return;
			boolean landed = target instanceof LivingEntity le && le.hurtTime > 0;
			boolean dead = target instanceof LivingEntity le2 && (le2.isDeadOrDying() || !le2.isAlive());
			if (landed || dead) {
				markKind = dead ? 2 : crit ? 1 : 0;
				markAt = System.currentTimeMillis();
				lastHitAt = markAt;
				combo++;
				Module hm = Panel.byId("hitmarker");
				if (hm instanceof HitMarker h && h.enabled && h.sound.value) {
					float pitch = markKind == 2 ? 0.8f : markKind == 1 ? 1.8f : 1.4f;
					mc.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.NOTE_BLOCK_HAT.value(), pitch, (float) (h.volume.value / 100.0)));
				}
				target = null;
				return;
			}
			if (--wait <= 0) target = null;
		}

		static int combo() {
			return combo;
		}
	}

	/* ------------------------------ HUD modules ------------------------------ */

	/** The attack charge (the game's cooldown) as a small bar under the crosshair. */
	static final class AttackCharge extends Module {
		private final Opt.Bool hideFull = opt(new Opt.Bool("hideFull", "Hide when fully charged", true));
		private final Opt.Bool sound = opt(new Opt.Bool("sound", "Quiet click when ready", false));
		private final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFFFFFFFF));
		private boolean wasFull = true;

		AttackCharge() {
			super("attackcharge", "Attack Cooldown", Cat.HUD, "attackcd", "Your sword/axe charge as a bar under the crosshair.", true, false, Anchor.CENTER, -20, 10);
		}

		@Override
		public void tick(Minecraft mc) {
			if (mc.player == null) return;
			boolean full = mc.player.getAttackStrengthScale(0f) >= 1f;
			if (full && !wasFull && sound.value) mc.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK.value(), 2f, 0.15f));
			wasFull = full;
		}

		@Override
		public void render(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
			float f = mc.player == null ? 0.6f : mc.player.getAttackStrengthScale(0f);
			lastW = 40;
			lastH = 4;
			if (f >= 1f && hideFull.value && !preview) return;
			if (preview && f >= 1f) f = 0.6f;
			Draw.round(g, 0, 0, 40, 4, 2, 0x80000000);
			Draw.round(g, 0, 0, Math.max(2, Math.round(40 * f)), 4, 2, f >= 1f ? 0xFF55FF55 : color.value);
		}
	}

	/** How far your bow is drawn (full power at 100%). */
	static final class BowDraw extends Module {
		BowDraw() {
			super("bowdraw", "Bow Draw", Cat.HUD, "bowdraw", "How far your bow is drawn; green at full power.", true, false, Anchor.CENTER, -20, 16);
		}

		@Override
		public void render(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
			lastW = 40;
			lastH = 4;
			float f = -1;
			if (mc.player != null && mc.player.isUsingItem() && mc.player.getUseItem().getItem() instanceof BowItem) f = BowItem.getPowerForTime(mc.player.getTicksUsingItem());
			if (f < 0 && preview) f = 0.7f;
			if (f < 0) return;
			Draw.round(g, 0, 0, 40, 4, 2, 0x80000000);
			Draw.round(g, 0, 0, Math.max(2, Math.round(40 * f)), 4, 2, f >= 1f ? 0xFF55FF55 : 0xFFFFAA00);
		}
	}

	/** The item in your off hand and how many. */
	static final class OffhandTile extends Module {
		OffhandTile() {
			super("offhand", "Offhand Item", Cat.HUD, "offhand", "The item in your off hand and how many you have.", true, false, Anchor.BOTTOM, 98, -20);
		}

		@Override
		public void render(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
			ItemStack st = mc.player == null ? ItemStack.EMPTY : mc.player.getOffhandItem();
			if (st.isEmpty() && preview) st = new ItemStack(Items.TOTEM_OF_UNDYING);
			lastW = 20;
			lastH = 20;
			if (st.isEmpty()) return;
			Draw.round(g, 0, 0, 20, 20, 3, 0x73000000);
			g.item(st, 2, 2);
			g.itemDecorations(Draw.font(), st, 2, 2);
		}
	}

	/** Whether the tool in your hand is the right one for the block you look at. */
	static final class RightTool extends Module {
		RightTool() {
			super("righttool", "Right Tool", Cat.HUD, "righttool", "Whether your tool is right for the block you look at.", true, false, Anchor.CENTER, 12, 20);
		}

		@Override
		public void render(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
			String t = null;
			int c = 0xFF55FF55;
			if (mc.player != null && mc.hitResult != null && mc.hitResult.getType() == HitResult.Type.BLOCK) {
				var state = mc.level.getBlockState(((BlockHitResult) mc.hitResult).getBlockPos());
				if (state.requiresCorrectToolForDrops() || mc.player.getMainHandItem().getDestroySpeed(state) > 1f) {
					boolean ok = mc.player.getMainHandItem().isCorrectToolForDrops(state) || !state.requiresCorrectToolForDrops() && mc.player.getMainHandItem().getDestroySpeed(state) > 1f;
					t = ok ? "Right tool" : "Wrong tool";
					c = ok ? 0xFF55FF55 : 0xFFFF5555;
				}
			}
			if (t == null && preview) t = "Right tool";
			lastW = Draw.font().width("Wrong tool") + 2;
			lastH = 9;
			if (t != null) g.text(Draw.font(), t, 0, 0, c, true);
		}
	}

	/** A flashing warning (and a sound) when your health or hunger gets low. */
	static final class LowAlert extends Module {
		private final Opt.Num hp = opt(new Opt.Num("hp", "Health below", 2, 16, 1, 6, " HP"));
		private final Opt.Num food = opt(new Opt.Num("food", "Hunger below", 2, 16, 1, 6, ""));
		private final Opt.Bool sound = opt(new Opt.Bool("sound", "Sound", true));
		private boolean was;

		LowAlert() {
			super("lowalert", "Low Health / Hunger Alert", Cat.HUD, "alert", "A warning (and a sound) when your health or hunger gets low.", true, false, Anchor.CENTER, -50, -40);
		}

		private String text(Minecraft mc) {
			if (mc.player == null) return null;
			if (mc.player.getHealth() <= hp.value) return "Low health!";
			if (mc.player.getFoodData().getFoodLevel() <= food.value) return "Low hunger!";
			return null;
		}

		@Override
		public void tick(Minecraft mc) {
			boolean now = text(mc) != null;
			if (now && !was && sound.value) mc.getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.NOTE_BLOCK_BASS.value(), 0.6f, 0.6f));
			was = now;
		}

		@Override
		public void render(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
			String t = text(mc);
			if (t == null && preview) t = "Low health!";
			lastW = 100;
			lastH = 15;
			if (t == null) return;
			if (!preview && (System.currentTimeMillis() / 400) % 2 == 0) return;
			Draw.round(g, 0, 0, 100, 15, 3, 0xB0A01818);
			Draw.centered(g, t, 50, 4, 1f, 0xFFFFFFFF);
		}
	}

	/** How much food you carry, red when it runs low. */
	static final class FoodStock extends Module {
		private final Opt.Num below = opt(new Opt.Num("below", "Warn below", 1, 32, 1, 8, ""));

		FoodStock() {
			super("foodstock", "Food Stock", Cat.HUD, "foodstock", "How much food you carry; red when it runs low.", true, false, Anchor.BOTTOM, 98, -82);
		}

		@Override
		public void render(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
			int n = 0;
			if (mc.player != null) {
				var inv = mc.player.getInventory();
				for (int i = 0; i < inv.getContainerSize(); i++) if (inv.getItem(i).has(DataComponents.FOOD)) n += inv.getItem(i).getCount();
			}
			if (preview && n == 0) n = 12;
			String t = "Food " + n;
			int w = Draw.font().width(t) + 8;
			Draw.round(g, 0, 0, w, 15, 3, 0x73000000);
			g.text(Draw.font(), t, 4, 4, n < below.value ? 0xFFFF5555 : 0xFFFFFFFF, true);
			lastW = w;
			lastH = 15;
		}
	}

	/** Frame time and the 1% low: the stutters an FPS number hides. */
	static final class FrameTime extends Module {
		private final long[] frames = new long[600];
		private int n, at;
		private long last;
		private String shown = "";
		private long nextUpdate;

		FrameTime() {
			super("frametime", "Frame Time", Cat.HUD, "frametime", "Milliseconds per frame and the 1% low FPS (the stutters).", true, false, Anchor.LEFT, 4, -76);
		}

		@Override
		public void render(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
			long now = System.nanoTime();
			if (last != 0) {
				frames[at] = now - last;
				at = (at + 1) % frames.length;
				n = Math.min(n + 1, frames.length);
			}
			last = now;
			if (now > nextUpdate && n > 20) {
				long[] c = Arrays.copyOf(frames, n);
				Arrays.sort(c);
				double avg = 0;
				for (long x : c) avg += x;
				avg = avg / n / 1e6;
				double worst = c[Math.max(0, (int) (n * 0.99) - 1)] / 1e6;
				shown = String.format(Locale.ROOT, "%.1f ms  1%% low %d", avg, Math.round(1000 / Math.max(0.1, worst)));
				nextUpdate = now + 500_000_000L;
			}
			String t = shown.isEmpty() ? "6.9 ms  1% low 92" : shown;
			int w = Draw.font().width(t) + 8;
			Draw.round(g, 0, 0, w, 15, 3, 0x73000000);
			g.text(Draw.font(), t, 4, 4, 0xFFFFFFFF, true);
			lastW = w;
			lastH = 15;
		}
	}

	/** A small mark at the crosshair when your hit lands: another colour for a critical hit and for a kill. */
	public static final class HitMarker extends Module {
		private final Opt.Choice shape = opt(new Opt.Choice("shape", "Shape", 0, "Cross", "Dot", "Ring"));
		private final Opt.Color hit = opt(new Opt.Color("hit", "Hit colour", 0xFFFFFFFF));
		private final Opt.Color critColor = opt(new Opt.Color("crit", "Critical hit colour", 0xFFFFAA00));
		private final Opt.Color kill = opt(new Opt.Color("kill", "Kill colour", 0xFFFF5555));
		private final Opt.Num size = opt(new Opt.Num("size", "Size", 3, 12, 1, 6, ""));
		private final Opt.Num time = opt(new Opt.Num("time", "Shows for", 100, 800, 50, 300, " ms"));
		final Opt.Bool sound = opt(new Opt.Bool("sound", "Sound", false));
		final Opt.Num volume = opt(new Opt.Num("volume", "Sound volume", 5, 100, 5, 40, "%"));

		HitMarker() {
			super("hitmarker", "Hit Marker", Cat.VISUAL, "hitmarker", "A mark at the crosshair when your hit lands (crits and kills in other colours).", true, false, Anchor.CENTER, -8, -8);
		}

		@Override
		public void render(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
			int s = (int) size.value;
			lastW = s * 2 + 4;
			lastH = s * 2 + 4;
			long age = System.currentTimeMillis() - HitTracker.markAt;
			if (!preview && age > time.value) return;
			int c = HitTracker.markKind == 2 ? kill.value : HitTracker.markKind == 1 ? critColor.value : hit.value;
			int cx = s + 2, cy = s + 2;
			switch (shape.value) {
				case 1 -> Draw.round(g, cx - 2, cy - 2, 5, 5, 2, c);
				case 2 -> g.outline(cx - s, cy - s, s * 2, s * 2, c);
				default -> {
					for (int i = 2; i <= s; i++) {
						g.fill(cx - i, cy - i, cx - i + 1, cy - i + 1, c);
						g.fill(cx + i, cy - i, cx + i + 1, cy - i + 1, c);
						g.fill(cx - i, cy + i, cx - i + 1, cy + i + 1, c);
						g.fill(cx + i, cy + i, cx + i + 1, cy + i + 1, c);
					}
				}
			}
		}
	}

	/* ------------------------------ Utility / Chat / Visual ------------------------------ */

	/** A key (F7, change it in Controls) that hides every Reminth HUD display - for screenshots and recordings. */
	static final class HideHud extends Module {
		HideHud() {
			super("hidehud", "Hide HUD Key", Cat.UTILITY, "hidehud", "Press F7 (change it in Controls) to hide all Reminth displays for a screenshot; again to show them.", true, true, null, 0, 0);
		}

		@Override
		public void tick(Minecraft mc) {
			while (Panel.hideKey() != null && Panel.hideKey().consumeClick()) Panel.hudHidden = !Panel.hudHidden;
		}

		@Override
		public void onDisable(Minecraft mc) {
			Panel.hudHidden = false;
		}
	}

	/** A friendly reminder to take a break after a while. */
	static final class BreakReminder extends Module {
		private final Opt.Num minutes = opt(new Opt.Num("minutes", "Every", 15, 180, 15, 60, " min"));
		private long since = System.currentTimeMillis();

		BreakReminder() {
			super("breakreminder", "Break Reminder", Cat.UTILITY, "breakrem", "A friendly message after you have played for a while.", true, false, null, 0, 0);
		}

		@Override
		public void tick(Minecraft mc) {
			if (mc.player == null) {
				since = System.currentTimeMillis();
				return;
			}
			if (System.currentTimeMillis() - since >= minutes.value * 60_000L) {
				since = System.currentTimeMillis();
				mc.player.sendSystemMessage(Component.literal("[Reminth] You have played for " + Math.round(minutes.value) + " minutes - a short break helps your eyes.").withStyle(ChatFormatting.GOLD));
			}
		}
	}

	/** Durability numbers in item tooltips. */
	static final class TooltipDurability extends Module {
		TooltipDurability() {
			super("tooltipdur", "Durability in Tooltips", Cat.UTILITY, "tooltipdur", "Item tooltips show the exact durability left.", true, true, null, 0, 0);
		}
	}

	/** Hunger and saturation in food tooltips. */
	static final class TooltipFood extends Module {
		TooltipFood() {
			super("tooltipfood", "Food Values in Tooltips", Cat.UTILITY, "tooltipfood", "Food tooltips show how much hunger and saturation it gives.", true, false, null, 0, 0);
		}
	}

	/** Registered once: the tooltip lines of the two features above. */
	static void initTooltips() {
		ItemTooltipCallback.EVENT.register((stack, context, flag, lines) -> {
			try {
				Module d = Panel.byId("tooltipdur");
				if (d != null && d.enabled && stack.isDamageableItem()) {
					int left = stack.getMaxDamage() - stack.getDamageValue();
					lines.add(Component.literal("Durability: " + left + " / " + stack.getMaxDamage()).withStyle(ChatFormatting.GRAY));
				}
				Module f = Panel.byId("tooltipfood");
				FoodProperties food = stack.get(DataComponents.FOOD);
				if (f != null && f.enabled && food != null) {
					lines.add(Component.literal("Hunger +" + food.nutrition() + "  Saturation +" + String.format(Locale.ROOT, "%.1f", food.saturation())).withStyle(ChatFormatting.GRAY));
				}
			} catch (Throwable ignored) {
				// a tooltip line is never worth an error
			}
		});
	}

	/** Your computer's time in front of every chat message (mixin/ChatTimestampMixin). */
	public static final class ChatTimestamps extends Module {
		private final Opt.Choice format = opt(new Opt.Choice("format", "Format", 0, "24 hour", "12 hour"));
		private final Opt.Bool seconds = opt(new Opt.Bool("seconds", "Seconds", false));

		ChatTimestamps() {
			super("chattime", "Chat Timestamps", Cat.CHAT, "chattime", "The time in front of each chat message.", true, false, null, 0, 0);
		}

		public Component stamp(Component msg) {
			String p = format.value == 0 ? (seconds.value ? "HH:mm:ss" : "HH:mm") : (seconds.value ? "h:mm:ss a" : "h:mm a");
			return Component.empty().append(Component.literal("[" + LocalTime.now().format(DateTimeFormatter.ofPattern(p, Locale.ROOT)) + "] ").withStyle(ChatFormatting.GRAY)).append(msg);
		}
	}
}
