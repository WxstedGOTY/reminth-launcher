package com.wxsted.reminthhud.client.panel;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import net.minecraft.client.AttackIndicatorStatus;
import net.minecraft.client.CameraType;
import net.minecraft.client.CloudStatus;
import net.minecraft.client.GraphicsPreset;
import net.minecraft.client.InactivityFpsLimit;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.MusicToastDisplayState;
import net.minecraft.client.PrioritizeChunkUpdates;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.sounds.MusicManager;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ParticleStatus;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.entity.player.ChatVisiblity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;

/**
 * Batch 2 (7 Oct 2026): more HUD displays (all only about you and what you could see anyway), Snaplook, and the game's
 * own settings as cards (OptionFeature) across Visual, Performance, Chat, Mechanic and Utility.
 */
public final class Features2 {
	private Features2() {
	}

	static List<Module> all() {
		List<Module> l = new ArrayList<>();
		l.addAll(hud());
		l.add(new Snaplook());
		l.addAll(settings());
		return l;
	}

	/* ------------------------------ HUD ------------------------------ */

	/** A one-line HUD from a lambda. */
	static final class Line extends TextHud {
		interface Value {
			String get(Minecraft mc, boolean preview);
		}

		private final String label;
		private final Value value;

		Line(String id, String name, String icon, String desc, String label, Anchor a, int dx, int dy, Value value) {
			super(id, name, icon, desc, false, a, dx, dy);
			this.label = label;
			this.value = value;
		}

		@Override
		protected String label(Minecraft mc) {
			return label;
		}

		@Override
		protected String value(Minecraft mc, boolean preview) {
			String v = mc.player == null ? null : value.get(mc, preview);
			return v == null && preview ? value.get(null, true) : v;
		}
	}

	private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("EEE d MMM", Locale.ROOT);
	private static long sessionStart = System.currentTimeMillis();
	private static String lastLevel = "";
	private static BlockPos deathPos;
	private static String deathDim = "";
	private static double lastX, lastZ, speed;

	/** Things tracked every tick for the HUD lines below (session time, speed, death point). */
	static void tick(Minecraft mc) {
		if (mc.player == null || mc.level == null) {
			lastLevel = "";
			return;
		}
		String lvl = String.valueOf(mc.getCurrentServer() == null ? "sp" : mc.getCurrentServer().ip);
		if (!lvl.equals(lastLevel)) {
			lastLevel = lvl;
			sessionStart = System.currentTimeMillis();
		}
		double dx = mc.player.getX() - lastX, dz = mc.player.getZ() - lastZ;
		speed = speed * 0.7 + Math.sqrt(dx * dx + dz * dz) * 20 * 0.3;
		lastX = mc.player.getX();
		lastZ = mc.player.getZ();
		if (mc.player.isDeadOrDying()) {
			deathPos = mc.player.blockPosition();
			deathDim = mc.level.dimension().identifier().getPath();
		}
	}

	private static String dimName(Minecraft mc) {
		return mc.level == null ? "overworld" : mc.level.dimension().identifier().getPath();
	}

	private static long time(Minecraft mc) {
		return mc.level == null ? 6000 : mc.level.getOverworldClockTime();
	}

	static List<Module> hud() {
		List<Module> l = new ArrayList<>();
		Module.Anchor L = Module.Anchor.LEFT;
		l.add(new Line("biome", "Biome", "biome", "The biome you are in.", "Biome", L, 4, 32, (mc, p) -> mc == null ? "Plains" :
				OptionFeature.pretty(mc.level.getBiome(mc.player.blockPosition()).unwrapKey().map(k -> k.identifier().getPath()).orElse("?"))));
		l.add(new Line("day", "Day Counter", "day", "How many days have passed in this world.", "Day", L, 4, 50, (mc, p) -> Long.toString(time(mc) / 24000 + 1)));
		l.add(new Line("worldtime", "World Time", "sun", "The time of day in the world, as a clock.", "Time", L, 4, 68, (mc, p) -> {
			long t = (time(mc) + 6000) % 24000;
			return String.format(Locale.ROOT, "%02d:%02d", t / 1000, (t % 1000) * 60 / 1000);
		}));
		l.add(new Line("health", "Health Numbers", "heart", "Your health as a number (and absorption).", "HP", L, 4, 86, (mc, p) -> {
			if (mc == null) return "20 / 20";
			float a = mc.player.getAbsorptionAmount();
			return String.format(Locale.ROOT, "%.0f / %.0f", mc.player.getHealth(), mc.player.getMaxHealth()) + (a > 0 ? String.format(Locale.ROOT, " +%.0f", a) : "");
		}));
		l.add(new Line("food", "Food & Saturation", "food", "Your hunger and saturation as numbers.", "Food", L, 4, 104, (mc, p) -> mc == null ? "20  sat 5.0" :
				mc.player.getFoodData().getFoodLevel() + "  sat " + String.format(Locale.ROOT, "%.1f", mc.player.getFoodData().getSaturationLevel())));
		l.add(new Line("armorpts", "Armor Points", "shield", "Your armor points as a number.", "Armor", L, 4, 122, (mc, p) -> mc == null ? "20" : Integer.toString(mc.player.getArmorValue())));
		l.add(new Line("memory", "Memory Usage", "memory", "How much memory the game uses.", "RAM", Module.Anchor.TOP_RIGHT, -110, 40, (mc, p) -> {
			Runtime r = Runtime.getRuntime();
			long used = (r.totalMemory() - r.freeMemory()) >> 20, max = r.maxMemory() >> 20;
			return used + " / " + max + " MB";
		}));
		l.add(new Line("serveraddr", "Server Address", "server", "The server you are on.", "", Module.Anchor.TOP_RIGHT, -110, 58, (mc, p) -> mc == null ? "play.example.net" :
				mc.getCurrentServer() == null ? "Singleplayer" : mc.getCurrentServer().ip));
		l.add(new Line("session", "Session Time", "hourglass", "How long you have played since joining.", "Played", Module.Anchor.TOP_RIGHT, -110, 76, (mc, p) -> {
			long s = mc == null ? 754 : (System.currentTimeMillis() - sessionStart) / 1000;
			return s >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60);
		}));
		l.add(new Line("speed", "Speed", "speed", "How fast you move, in blocks per second.", "Speed", L, 4, 140, (mc, p) -> String.format(Locale.ROOT, "%.1f b/s", mc == null ? 5.6 : speed)));
		l.add(new Line("light", "Light Level", "bulb", "The light level where you stand.", "Light", L, 4, 158, (mc, p) -> mc == null ? "15" : Integer.toString(mc.level.getMaxLocalRawBrightness(mc.player.blockPosition()))));
		l.add(new Line("chunk", "Chunk Position", "chunk", "Which chunk you are in, and where in it.", "Chunk", L, 4, 176, (mc, p) -> {
			if (mc == null) return "7 -21  (4, 9)";
			BlockPos b = mc.player.blockPosition();
			return (b.getX() >> 4) + " " + (b.getZ() >> 4) + "  (" + (b.getX() & 15) + ", " + (b.getZ() & 15) + ")";
		}));
		l.add(new Line("facingdeg", "Facing", "facing", "Which way you look, in degrees.", "Yaw", L, 4, 194, (mc, p) -> {
			if (mc == null) return "174.0  pitch 12.0";
			float yaw = ((mc.player.getYRot() % 360) + 360) % 360;
			return String.format(Locale.ROOT, "%.1f  pitch %.1f", yaw, mc.player.getXRot());
		}));
		l.add(new Line("blockinfo", "Block Info", "blockinfo", "The name of the block you look at.", "", Module.Anchor.TOP, 0, 24, (mc, p) -> {
			if (mc == null) return "Oak Log";
			HitResult hit = mc.hitResult;
			if (hit == null || hit.getType() != HitResult.Type.BLOCK) return p ? "Oak Log" : null;
			return mc.level.getBlockState(((BlockHitResult) hit).getBlockPos()).getBlock().getName().getString();
		}));
		l.add(new Line("moon", "Moon Phase", "moon", "Tonight's moon.", "Moon", Module.Anchor.TOP_RIGHT, -110, 94, (mc, p) -> {
			String[] phases = {"Full", "Waning gibbous", "Last quarter", "Waning crescent", "New", "Waxing crescent", "First quarter", "Waxing gibbous"};
			return phases[(int) ((time(mc) / 24000) % 8)];
		}));
		l.add(new Line("weather", "Weather", "weather", "Clear, rain or thunder.", "Weather", Module.Anchor.TOP_RIGHT, -110, 112, (mc, p) -> mc == null ? "Clear" :
				mc.level.isThundering() ? "Thunder" : mc.level.isRaining() ? "Rain" : "Clear"));
		l.add(new Line("date", "Date", "date", "Today's date on your computer.", "", Module.Anchor.TOP_RIGHT, -60, 22, (mc, p) -> LocalDate.now().format(DATE)));
		l.add(new Line("players", "Players Online", "players", "How many players the player list shows.", "Online", Module.Anchor.TOP_RIGHT, -110, 130, (mc, p) -> mc == null ? "57" :
				mc.getConnection() == null ? "1" : Integer.toString(mc.getConnection().getOnlinePlayers().size())));
		l.add(new Line("xp", "XP Level", "xp", "Your level and how far to the next one.", "Lvl", L, 4, 212, (mc, p) -> mc == null ? "30  (42%)" :
				mc.player.experienceLevel + "  (" + Math.round(mc.player.experienceProgress * 100) + "%)"));
		l.add(new Line("death", "Death Point", "skull", "Where you last died.", "Died", L, 4, -58, (mc, p) -> {
			if (deathPos == null) return p || mc == null ? "-312 64 1180" : null;
			return deathPos.getX() + " " + deathPos.getY() + " " + deathPos.getZ() + (deathDim.equals(dimName(mc)) ? "" : " (" + OptionFeature.pretty(deathDim) + ")");
		}));
		l.add(new Line("elytra", "Elytra Flight", "elytra", "Your angle and speed while flying with an elytra.", "Fly", Module.Anchor.CENTER, 20, 20, (mc, p) -> {
			if (mc == null) return "-12.0  31.4 b/s";
			if (!mc.player.isFallFlying()) return p ? "-12.0  31.4 b/s" : null;
			return String.format(Locale.ROOT, "%.1f  %.1f b/s", -mc.player.getXRot(), mc.player.getDeltaMovement().length() * 20);
		}));
		l.add(new Line("inventoryfull", "Inventory Full", "chest", "Shows when your inventory has no empty slot.", "", Module.Anchor.BOTTOM, -30, -62, (mc, p) -> {
			if (mc == null) return "Inventory full";
			var inv = mc.player.getInventory();
			for (int i = 0; i < 36; i++) if (inv.getItem(i).isEmpty()) return p ? "Inventory full" : null;
			return "Inventory full";
		}));
		l.add(new LowDurability());
		l.add(new ItemCounter());
		l.add(new Line("packs", "Resource Packs", "packs", "The resource packs you have on.", "Packs", Module.Anchor.BOTTOM_RIGHT, -160, -14, (mc, p) -> {
			if (mc == null) return "2";
			long n = mc.getResourcePackRepository().getSelectedPacks().stream().filter(x -> x.getId().startsWith("file/")).count();
			return Long.toString(n);
		}));
		l.add(new CompassStrip());
		return l;
	}

	/** Flashes when armor or the item in your hand is almost broken. */
	static final class LowDurability extends Module {
		private final Opt.Num at = opt(new Opt.Num("at", "Warn below", 5, 50, 5, 10, "%"));

		LowDurability() {
			super("lowdur", "Low Durability Warning", Cat.HUD, "warning", "Flashes when armor or the held item is almost broken.", true, false, Anchor.CENTER, -40, 30);
		}

		@Override
		public void render(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
			String worst = null;
			if (mc.player != null) {
				for (EquipmentSlot s : EquipmentSlot.values()) {
					ItemStack st = mc.player.getItemBySlot(s);
					if (st.isDamageableItem() && (st.getMaxDamage() - st.getDamageValue()) * 100.0 / st.getMaxDamage() <= at.value) {
						worst = st.getHoverName().getString();
						break;
					}
				}
			}
			if (worst == null && preview) worst = "Diamond Chestplate";
			if (worst == null) return;
			String t = worst + " is almost broken!";
			boolean on = preview || (System.currentTimeMillis() / 400) % 2 == 0;
			int w = Draw.font().width(t) + 8;
			if (on) {
				Draw.round(g, 0, 0, w, 15, 3, 0xB0A01818);
				g.text(Draw.font(), t, 4, 4, 0xFFFFFFFF, true);
			}
			lastW = w;
			lastH = 15;
		}
	}

	/** Counts chosen items you carry: arrows, pearls, golden apples, blocks... */
	static final class ItemCounter extends Module {
		private final Opt.Bool arrows = opt(new Opt.Bool("arrows", "Arrows", true));
		private final Opt.Bool pearls = opt(new Opt.Bool("pearls", "Ender pearls", true));
		private final Opt.Bool gapples = opt(new Opt.Bool("gapples", "Golden apples", true));
		private final Opt.Bool crystals = opt(new Opt.Bool("crystals", "End crystals", false));
		private final Opt.Bool potions = opt(new Opt.Bool("potions", "Splash potions", false));
		private final Opt.Bool xpBottles = opt(new Opt.Bool("xpbottles", "Bottles o' enchanting", false));
		private final Opt.Bool hideZero = opt(new Opt.Bool("hideZero", "Hide ones you have none of", true));

		ItemCounter() {
			super("itemcounter", "Item Counter", Cat.HUD, "arrows", "How many arrows, pearls, golden apples... you carry.", true, false, Anchor.BOTTOM, 98, -60);
		}

		private int count(Minecraft mc, net.minecraft.world.item.Item item) {
			if (mc.player == null) return 0;
			int n = 0;
			var inv = mc.player.getInventory();
			for (int i = 0; i < inv.getContainerSize(); i++) if (inv.getItem(i).is(item)) n += inv.getItem(i).getCount();
			return n;
		}

		@Override
		public void render(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
			Object[][] rows = {
				{arrows, Items.ARROW}, {pearls, Items.ENDER_PEARL}, {gapples, Items.GOLDEN_APPLE}, {crystals, Items.END_CRYSTAL}, {potions, Items.SPLASH_POTION}, {xpBottles, Items.EXPERIENCE_BOTTLE},
			};
			int x = 0;
			for (Object[] r : rows) {
				if (!((Opt.Bool) r[0]).value) continue;
				var item = (net.minecraft.world.item.Item) r[1];
				int n = count(mc, item);
				if (preview && n == 0) n = 16;
				if (n == 0 && hideZero.value) continue;
				g.item(new ItemStack(item), x, 0);
				String t = Integer.toString(n);
				g.text(Draw.font(), t, x + 17, 5, 0xFFFFFFFF, true);
				x += 19 + Draw.font().width(t) + 4;
			}
			lastW = Math.max(18, x);
			lastH = 16;
		}
	}

	/** A compass strip at the top of the screen: N, E, S, W and the degrees. */
	static final class CompassStrip extends Module {
		CompassStrip() {
			super("compass", "Direction HUD", Cat.HUD, "compass", "A compass strip at the top of the screen.", true, false, Anchor.TOP, -60, 4);
		}

		@Override
		public void render(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
			int w = 120, h = 14;
			float yaw = mc.player == null ? 180 : ((mc.player.getYRot() % 360) + 360) % 360;
			Draw.round(g, 0, 0, w, h, 3, 0x73000000);
			String[] names = {"S", "SW", "W", "NW", "N", "NE", "E", "SE"};
			g.enableScissor(0, 0, w, h);
			for (int i = 0; i < 16; i++) {
				float deg = i * 45f;
				float d = ((deg - yaw + 540) % 360) - 180;
				int x = Math.round(w / 2f + d * 1.2f);
				if (x < -10 || x > w + 10) continue;
				String n = names[i % 8];
				g.text(Draw.font(), n, x - Draw.font().width(n) / 2, 3, n.length() == 1 ? 0xFFFFFFFF : 0xFFB4B4B8, false);
			}
			g.disableScissor();
			g.fill(w / 2, h - 3, w / 2 + 1, h, 0xFFFF5555);
			lastW = w;
			lastH = h;
		}
	}

	/** Snaplook: hold a key to look behind you (third person), let go to come back. */
	static final class Snaplook extends Module {
		private CameraType before;
		private boolean held;

		Snaplook() {
			super("snaplook", "Snaplook", Cat.MECHANIC, "snaplook", "Hold V (change it in Controls) to look behind you for a moment.", true, false, null, 0, 0);
		}

		@Override
		public void tick(Minecraft mc) {
			KeyMapping k = Panel.snapKey();
			boolean down = k != null && k.isDown() && mc.gui.screen() == null;
			if (down && !held) {
				before = mc.options.getCameraType();
				mc.options.setCameraType(CameraType.THIRD_PERSON_FRONT);
			} else if (!down && held && before != null) {
				mc.options.setCameraType(before);
			}
			held = down;
		}

		@Override
		public void onDisable(Minecraft mc) {
			if (held && before != null) mc.options.setCameraType(before);
			held = false;
		}
	}

	/* ------------------------------ the game's own settings ------------------------------ */

	static List<Module> settings() {
		List<Module> l = new ArrayList<>();
		Module.Cat V = Module.Cat.VISUAL, P = Module.Cat.PERFORMANCE, C = Module.Cat.CHAT, M = Module.Cat.MECHANIC, U = Module.Cat.UTILITY;
		// Visual
		l.add(OptionFeature.bool("nobob", "No View Bobbing", V, "bob", "The camera doesn't bob up and down as you walk.", o -> o.bobView(), false));
		l.add(OptionFeature.percent("fovfx", "Speed FOV Effect", V, "fov", "How much sprinting and speed change your field of view.", o -> o.fovEffectScale(), "Strength", 0, 100, 5, 0));
		l.add(OptionFeature.percent("distortion", "Screen Distortion", V, "swirl", "How much nausea and portals wobble the screen.", o -> o.screenEffectScale(), "Strength", 0, 100, 5, 0));
		l.add(OptionFeature.percent("darkness", "Darkness Pulse", V, "dark", "How much the Darkness effect pulses.", o -> o.darknessEffectScale(), "Strength", 0, 100, 5, 0));
		l.add(OptionFeature.percent("glintstr", "Enchant Glint Strength", V, "sparkle", "How bright the enchantment shine is.", o -> o.glintStrength(), "Strength", 0, 100, 5, 50));
		l.add(OptionFeature.percent("glintspd", "Enchant Glint Speed", V, "sparkle_speed", "How fast the enchantment shine moves.", o -> o.glintSpeed(), "Speed", 0, 100, 5, 50));
		l.add(OptionFeature.choice("clouds", "Clouds", V, "cloud", "Fancy, fast or no clouds.", o -> o.cloudStatus(), "Clouds", CloudStatus.values(), 0));
		l.add(OptionFeature.integer("cloudrange", "Cloud Distance", V, "cloud", "How far away clouds are drawn.", o -> o.cloudRange(), "Distance", 2, 128, 2, 64, " chunks"));
		l.add(OptionFeature.choice("particles", "Particles", V, "particles", "All, fewer or the fewest particles.", o -> o.particles(), "Amount", ParticleStatus.values(), 1));
		l.add(OptionFeature.bool("noshadows", "No Entity Shadows", V, "shadow", "No round shadows under mobs and players.", o -> o.entityShadows(), false));
		l.add(OptionFeature.bool("nolightning", "No Lightning Flash", V, "bolt", "The sky doesn't flash white when lightning strikes.", o -> o.hideLightningFlash(), true));
		l.add(OptionFeature.bool("novignette", "No Vignette", V, "vignette", "No dark edges around the screen.", o -> o.vignette(), false));
		l.add(OptionFeature.integer("menublur", "Menu Blur", V, "blur", "How blurry the world is behind menus.", o -> o.menuBackgroundBlurriness(), "Blur", 0, 10, 1, 2, ""));
		l.add(OptionFeature.percent("textbg", "Text Background", V, "textbg", "How dark the box behind name tags and chat is.", o -> o.textBackgroundOpacity(), "Opacity", 0, 100, 5, 50));
		l.add(OptionFeature.integer("fovset", "Field of View", V, "fov", "Your field of view.", o -> o.fov(), "FOV", 30, 110, 1, 90, ""));
		l.add(OptionFeature.bool("boldoutline", "Bold Block Outline", V, "outline", "A thicker, easier to see outline on the block you look at.", o -> o.highContrastBlockOutline(), true));
		l.add(OptionFeature.choice("attackind", "Attack Indicator", V, "crosshair", "Where the attack cooldown shows: crosshair, hotbar or nowhere.", o -> o.attackIndicator(), "Show", AttackIndicatorStatus.values(), 1));
		// Performance
		l.add(OptionFeature.integer("fpslimit", "FPS Limit", P, "fpslimit", "The highest frame rate the game runs at (260 = unlimited).", o -> o.framerateLimit(), "Limit", 10, 260, 10, 140, " FPS"));
		l.add(OptionFeature.bool("novsync", "No VSync", P, "vsync", "Frames aren't held back to your monitor's refresh rate.", o -> o.enableVsync(), false));
		l.add(OptionFeature.integer("renderdist", "Render Distance", P, "render", "How far the world is drawn.", o -> o.renderDistance(), "Distance", 2, 32, 1, 12, " chunks"));
		l.add(OptionFeature.integer("simdist", "Simulation Distance", P, "simulation", "How far away things keep moving and growing (singleplayer).", o -> o.simulationDistance(), "Distance", 5, 32, 1, 8, " chunks"));
		l.add(OptionFeature.percent("entitydist", "Entity Distance", P, "entitydist", "How far away mobs and players are drawn.", o -> o.entityDistanceScaling(), "Distance", 50, 500, 25, 100));
		l.add(OptionFeature.integer("biomeblend", "Biome Blend", P, "blend", "How smoothly colours blend between biomes (0 is fastest).", o -> o.biomeBlendRadius(), "Blend", 0, 7, 1, 1, ""));
		l.add(OptionFeature.choice("bgfps", "Background FPS", P, "sleep", "How fast the game runs when you're not playing it.", o -> o.inactivityFpsLimit(), "When", InactivityFpsLimit.values(), 1));
		l.add(OptionFeature.choice("chunkupd", "Chunk Updates", P, "chunkupdate", "Which chunk changes are drawn first.", o -> o.prioritizeChunkUpdates(), "Priority", PrioritizeChunkUpdates.values(), 0));
		l.add(OptionFeature.choice("graphics", "Graphics Preset", P, "graphics", "The game's graphics preset.", o -> o.graphicsPreset(), "Preset", GraphicsPreset.values(), 0));
		l.add(OptionFeature.bool("transparency", "Improved Transparency", P, "glass", "Better looking glass and water (costs some FPS).", o -> o.improvedTransparency(), true));
		l.add(OptionFeature.bool("smoothlight", "Smooth Lighting", P, "bulb", "Soft shadows between blocks.", o -> o.ambientOcclusion(), true));
		l.add(OptionFeature.integer("mipmap", "Mipmap Levels", P, "mipmap", "Smoother far-away textures (0 is fastest).", o -> o.mipmapLevels(), "Levels", 0, 4, 1, 4, ""));
		l.add(OptionFeature.bool("leaves", "Solid Leaves", P, "leaf", "Leaves without see-through holes: faster.", o -> o.cutoutLeaves(), false));
		// Chat
		l.add(OptionFeature.percent("chatopacity", "Chat Opacity", C, "chat_opacity", "How see-through the chat is.", o -> o.chatOpacity(), "Opacity", 10, 100, 5, 100));
		l.add(OptionFeature.percent("chatscale", "Chat Size", C, "chat_size", "How big the chat text is.", o -> o.chatScale(), "Size", 0, 100, 5, 100));
		l.add(OptionFeature.percent("chatwidth", "Chat Width", C, "chat_width", "How wide the chat is.", o -> o.chatWidth(), "Width", 0, 100, 5, 100));
		l.add(OptionFeature.percent("chatheightf", "Chat Height (Open)", C, "chat_height", "How tall the chat is while open.", o -> o.chatHeightFocused(), "Height", 0, 100, 5, 100));
		l.add(OptionFeature.percent("chatheightu", "Chat Height (Closed)", C, "chat_height", "How tall the chat is while playing.", o -> o.chatHeightUnfocused(), "Height", 0, 100, 5, 44));
		l.add(OptionFeature.percent("chatspacing", "Chat Line Spacing", C, "chat_lines", "Space between chat lines.", o -> o.chatLineSpacing(), "Spacing", 0, 100, 5, 0));
		l.add(OptionFeature.number("chatdelay", "Chat Delay", C, "chat_delay", "Wait before new messages show.", o -> o.chatDelay(), "Delay", 0, 6, 0.5, 0, " s"));
		l.add(OptionFeature.bool("chatnocolors", "No Chat Colours", C, "chat_color", "Chat in plain white.", o -> o.chatColors(), false));
		l.add(OptionFeature.bool("chatnolinks", "No Clickable Links", C, "chat_link", "Links in chat can't be clicked.", o -> o.chatLinks(), false));
		l.add(OptionFeature.bool("chatlinkwarn", "Link Warning", C, "chat_warn", "Ask before opening a link from chat.", o -> o.chatLinksPrompt(), true));
		l.add(OptionFeature.bool("hidematched", "Hide Matched Names", C, "chat_hide", "Hide names the server marks as matched.", o -> o.hideMatchedNames(), true));
		l.add(OptionFeature.bool("securechat", "Only Secure Chat", C, "chat_secure", "Only show chat that is signed by its sender.", o -> o.onlyShowSecureChat(), true));
		l.add(OptionFeature.bool("nosuggest", "No Command Suggestions", C, "chat_suggest", "No pop-up while typing commands.", o -> o.autoSuggestions(), false));
		l.add(OptionFeature.bool("drafts", "Keep Chat Drafts", C, "chat_draft", "What you typed stays when you close the chat.", o -> o.saveChatDrafts(), true));
		l.add(OptionFeature.choice("chatvis", "Chat Visibility", C, "chat_visible", "Show all chat, only commands, or none.", o -> o.chatVisibility(), "Show", ChatVisiblity.values(), 0));
		l.add(OptionFeature.bool("chatbgonly", "Background Only for Chat", C, "textbg", "The dark text box only behind chat.", o -> o.backgroundForChatOnly(), true));
		// Mechanic
		l.add(OptionFeature.bool("noautojump", "No Auto-Jump", M, "jump", "You don't jump up blocks by yourself.", o -> o.autoJump(), false));
		l.add(OptionFeature.bool("rawinput", "Raw Mouse Input", M, "mouse", "Your mouse exactly as Windows reads it, no acceleration.", o -> o.rawMouseInput(), true));
		l.add(OptionFeature.bool("inverty", "Invert Mouse", M, "invert", "Moving the mouse up looks down.", o -> o.invertMouseY(), true));
		l.add(OptionFeature.percent("sensitivity", "Mouse Sensitivity", M, "sensitivity", "How fast the camera turns (100% is the game's middle).", o -> o.sensitivity(), "Sensitivity", 0, 100, 1, 50));
		l.add(OptionFeature.number("scrollsens", "Scroll Sensitivity", M, "wheel", "How far one scroll moves.", o -> o.mouseWheelSensitivity(), "Speed", 1, 10, 0.5, 1, "x"));
		l.add(OptionFeature.bool("discrete", "Discrete Scrolling", M, "wheel", "One scroll moves exactly one hotbar slot.", o -> o.discreteMouseScroll(), true));
		l.add(OptionFeature.bool("minecartturn", "No Minecart Turning", M, "minecart", "Your camera doesn't turn with the minecart.", o -> o.rotateWithMinecart(), false));
		l.add(OptionFeature.choice("mainhand", "Main Hand", M, "hand", "Which hand you hold items in.", o -> o.mainHand(), "Hand", HumanoidArm.values(), 1));
		// Utility
		l.add(OptionFeature.bool("subtitles", "Subtitles", U, "subtitles", "Words on screen for the sounds around you.", o -> o.showSubtitles(), true));
		l.add(OptionFeature.bool("noautosave", "No Autosave Icon", U, "save", "Hide the saving icon in the corner.", o -> o.showAutosaveIndicator(), false));
		l.add(OptionFeature.number("notifytime", "Notification Time", U, "bell", "How long pop-ups (advancements, toasts) stay.", o -> o.notificationDisplayTime(), "Time", 0.5, 10, 0.5, 2, "x"));
		l.add(OptionFeature.bool("nosplash", "No Splash Text", U, "splash", "No yellow joke text on the title screen.", o -> o.hideSplashTexts(), true));
		l.add(OptionFeature.choice("musicfreq", "Music Frequency", U, "music", "How often the game's music plays.", o -> o.musicFrequency(), "How often", MusicManager.MusicFrequency.values(), 0));
		l.add(OptionFeature.choice("musictoast", "Now Playing Pop-up", U, "musictoast", "Show what music is playing.", o -> o.musicToast(), "Show", MusicToastDisplayState.values(), 0));
		l.add(OptionFeature.bool("directional", "Directional Audio", U, "headphones", "3D sound for headphones.", o -> o.directionalAudio(), true));
		l.add(OptionFeature.bool("nonarrator", "No Narrator Shortcut", U, "speaker_off", "Ctrl+B no longer turns the narrator on by accident.", o -> o.narratorHotkey(), false));
		l.add(OptionFeature.bool("norealms", "No Realms Notifications", U, "bell", "No Realms news and invites on the title screen.", o -> o.realmsNotifications(), false));
		l.add(OptionFeature.bool("noserverlist", "Hide From Server Lists", U, "list", "Your name isn't shown in servers' player lists outside the game.", o -> o.allowServerListing(), false));
		l.add(OptionFeature.bool("highcontrast", "High Contrast", U, "contrast", "Higher contrast menus and buttons.", o -> o.highContrast(), true));
		l.add(OptionFeature.bool("unicode", "Unicode Font", U, "font", "A smoother font for all text.", o -> o.forceUnicodeFont(), true));
		l.add(OptionFeature.bool("reduceddebug", "Reduced Debug Info", U, "bug", "F3 shows less (handy when streaming).", o -> o.reducedDebugInfo(), true));
		l.add(OptionFeature.bool("darkloading", "Dark Loading Screen", U, "loading", "A black loading screen instead of red.", o -> o.darkMojangStudiosBackground(), true));
		l.add(OptionFeature.bool("notelemetry", "Less Telemetry", U, "antenna", "Don't send optional usage data to Mojang.", o -> o.telemetryOptInExtra(), false));
		return l;
	}
}
