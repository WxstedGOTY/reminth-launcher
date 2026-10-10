package com.wxsted.reminthhud.client.panel;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.PlayerModelPart;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.LightLayer;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;

/**
 * Batch 4 (10 Oct 2026, owner: "add about 300 more useful things that also Lunar has"): more displays about you and
 * what you can already see (server TPS, speeds, distances, what you look at, session stats, game info), item counters,
 * graphs, an inventory display, item pickups, a custom crosshair, screen effects, hotbar and status-bar numbers, FPS and
 * sound savers for when you tab out or go AFK, reminders and skin-part switches. Still nothing that plays for you or
 * shows what you couldn't see anyway.
 */
public final class Features4 {
	private Features4() {
	}

	static List<Module> all() {
		List<Module> l = new ArrayList<>();
		l.addAll(lines());
		l.addAll(counters());
		l.add(new Graph("fpsgraph", "FPS Graph", "fpsgraph", "Your FPS over the last seconds as a graph: drops show up at once.", 0));
		l.add(new Graph("pinggraph", "Ping Graph", "pinggraph", "Your ping over time as a graph.", 1));
		l.add(new InventoryHud());
		l.add(new Pickups());
		l.add(new AnalogClock());
		l.add(new CoordsBox());
		l.add(new ArmorBars());
		l.add(new HotbarNumbers());
		l.add(new HotbarTotals());
		l.add(new BarNumbers());
		l.add(new Crosshair());
		l.add(new LowHealthGlow());
		l.add(new DamageFlash());
		l.add(new ColorFilter());
		l.add(new UnfocusedFps());
		l.add(new AfkFps());
		l.add(new MuteBackground());
		l.add(new Reminders());
		Object[][] parts = {
			{"hidecape", "Hide Cape", PlayerModelPart.CAPE}, {"hidejacket", "Hide Jacket Layer", PlayerModelPart.JACKET},
			{"hidelsleeve", "Hide Left Sleeve Layer", PlayerModelPart.LEFT_SLEEVE}, {"hidersleeve", "Hide Right Sleeve Layer", PlayerModelPart.RIGHT_SLEEVE},
			{"hidelpants", "Hide Left Pants Layer", PlayerModelPart.LEFT_PANTS_LEG}, {"hiderpants", "Hide Right Pants Layer", PlayerModelPart.RIGHT_PANTS_LEG},
			{"hidehat", "Hide Hat Layer", PlayerModelPart.HAT},
		};
		for (Object[] p : parts) l.add(new SkinPart((String) p[0], (String) p[1], (PlayerModelPart) p[2]));
		return l;
	}

	static Module line(String id, String name, String icon, String desc, String label, Module.Anchor a, int dx, int dy, Features2.Line.Value v) {
		return new Features2.Line(id, name, icon, desc, label, a, dx, dy, v);
	}

	/* ------------------------------ tracking ------------------------------ */

	private static final ArrayDeque<long[]> tpsSamples = new ArrayDeque<>();
	static double tps = 20, vspeed, distance, speed3d;
	static int jumps;
	static long lastDeath, lastActive = System.currentTimeMillis();
	private static double px, py, pz;
	private static float pyaw, ppitch;
	private static boolean wasJump, wasDead, havePos;
	private static String session = "";
	static final int SAMPLES = 120;
	static final int[] fps = new int[SAMPLES], ping = new int[SAMPLES];
	static int sampleAt;
	/** Another feature holds the FPS limit or the volume right now (OptionFeature leaves those settings alone then). */
	static boolean holdingFps, holdingVolume;

	static void tick(Minecraft mc) {
		fps[sampleAt % SAMPLES] = mc.getFps();
		ping[sampleAt % SAMPLES] = PingMeter.ms(mc);
		sampleAt++;
		if (mc.player == null || mc.level == null) {
			havePos = false;
			tpsSamples.clear();
			return;
		}
		String s = mc.getCurrentServer() == null ? "sp" : mc.getCurrentServer().ip;
		if (!s.equals(session)) {
			session = s;
			distance = 0;
			jumps = 0;
			lastDeath = 0;
		}
		long now = System.currentTimeMillis();
		tpsSamples.addLast(new long[] {mc.level.getGameTime(), now});
		while (tpsSamples.size() > 2 && now - tpsSamples.peekFirst()[1] > 5000) tpsSamples.removeFirst();
		if (tpsSamples.size() > 20) {
			long[] a = tpsSamples.peekFirst(), b = tpsSamples.peekLast();
			if (b[1] > a[1]) tps = Math.min(20, (b[0] - a[0]) * 1000.0 / (b[1] - a[1]));
		}
		var p = mc.player;
		if (havePos) {
			double dx = p.getX() - px, dy = p.getY() - py, dz = p.getZ() - pz;
			double h = Math.sqrt(dx * dx + dz * dz);
			if (h < 10) distance += h; // not teleports
			vspeed = vspeed * 0.6 + dy * 20 * 0.4;
			speed3d = speed3d * 0.6 + Math.sqrt(dx * dx + dy * dy + dz * dz) * 20 * 0.4;
			if (Math.abs(p.getYRot() - pyaw) > 0.01 || Math.abs(p.getXRot() - ppitch) > 0.01 || h > 0.001) lastActive = now;
		}
		px = p.getX();
		py = p.getY();
		pz = p.getZ();
		pyaw = p.getYRot();
		ppitch = p.getXRot();
		havePos = true;
		boolean j = mc.options.keyJump.isDown();
		if (j && !wasJump && p.onGround()) jumps++;
		wasJump = j;
		for (var k : mc.options.keyMappings) if (k.isDown()) lastActive = now;
		boolean dead = p.isDeadOrDying();
		if (dead && !wasDead) lastDeath = now;
		wasDead = dead;
		DamageFlash.tickHealth(mc);
		if (Panel.byId("pickups") instanceof Pickups pk) pk.track(mc);
	}

	static String time(long s) {
		return s >= 3600 ? String.format(Locale.ROOT, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60);
	}

	static String dist(double m) {
		return m >= 1000 ? String.format(Locale.ROOT, "%.2f km", m / 1000) : String.format(Locale.ROOT, "%.0f m", m);
	}

	private static String[] DIRS = {"South", "South-West", "West", "North-West", "North", "North-East", "East", "South-East"};

	private static BlockPos target(Minecraft mc) {
		HitResult h = mc.hitResult;
		return h != null && h.getType() == HitResult.Type.BLOCK ? ((BlockHitResult) h).getBlockPos() : null;
	}

	/* ------------------------------ one-line displays ------------------------------ */

	static List<Module> lines() {
		List<Module> l = new ArrayList<>();
		Module.Anchor L = Module.Anchor.LEFT, TL = Module.Anchor.TOP_LEFT, TR = Module.Anchor.TOP_RIGHT, R = Module.Anchor.RIGHT, C = Module.Anchor.CENTER;
		l.add(line("tps", "Server TPS", "tps", "How fast the server runs (20 is full speed), worked out from how fast its clock moves.", "TPS", TL, 4, 4, (mc, p) -> mc == null ? "20.0" : String.format(Locale.ROOT, "%.1f", tps)));
		l.add(line("vspeed", "Vertical Speed", "vspeed", "How fast you go up or down, in blocks per second.", "Y speed", L, 4, 0, (mc, p) -> String.format(Locale.ROOT, "%+.1f b/s", mc == null ? -3.2 : vspeed)));
		l.add(line("speed3d", "3D Speed", "speed", "Your speed counting up and down too.", "3D", L, 4, 0, (mc, p) -> String.format(Locale.ROOT, "%.1f b/s", mc == null ? 7.4 : speed3d)));
		l.add(line("distance", "Distance Travelled", "distance", "How far you walked, ran, swam or flew this session.", "Travelled", L, 4, 0, (mc, p) -> dist(mc == null ? 1840 : distance)));
		l.add(line("jumps", "Jump Counter", "jump", "How many times you jumped this session.", "Jumps", L, 4, 0, (mc, p) -> Integer.toString(mc == null ? 128 : jumps)));
		l.add(line("sincedeath", "Time Since Death", "skull", "How long you have stayed alive.", "Alive", L, 4, 0, (mc, p) -> mc == null || lastDeath == 0 ? (mc == null ? "12:40" : time((System.currentTimeMillis() - Features2.sessionStart) / 1000)) : time((System.currentTimeMillis() - lastDeath) / 1000)));
		l.add(line("sealevel", "Height Above Sea", "sealevel", "How many blocks above (or below) sea level you are.", "Sea", L, 4, 0, (mc, p) -> mc == null ? "+21" : String.format(Locale.ROOT, "%+d", mc.player.blockPosition().getY() - mc.level.getSeaLevel())));
		l.add(line("targetpos", "Looked-at Block Position", "blockinfo", "Where the block you look at is.", "Block", C, 12, 70, (mc, p) -> {
			BlockPos b = mc == null ? null : target(mc);
			if (b == null) return p || mc == null ? "120 63 -41" : null;
			return b.getX() + " " + b.getY() + " " + b.getZ();
		}));
		l.add(line("targetdist", "Block Distance", "reach", "How far away the block you look at is.", "Dist", C, 12, 82, (mc, p) -> {
			if (mc == null || mc.hitResult == null || mc.hitResult.getType() != HitResult.Type.BLOCK) return p || mc == null ? "3.4 m" : null;
			return String.format(Locale.ROOT, "%.1f m", mc.hitResult.getLocation().distanceTo(mc.player.getEyePosition()));
		}));
		l.add(line("targetentity", "Looked-at Entity", "entity", "The name of the mob or player under your crosshair.", "", C, 12, 94, (mc, p) -> {
			Entity e = mc == null ? null : mc.crosshairPickEntity;
			if (e == null) return p || mc == null ? "Zombie" : null;
			return e.getName().getString();
		}));
		l.add(line("entitydist", "Entity Distance", "reach", "How far away the mob or player under your crosshair is.", "Range", C, 12, 106, (mc, p) -> {
			Entity e = mc == null ? null : mc.crosshairPickEntity;
			if (e == null) return p || mc == null ? "2.9 m" : null;
			return String.format(Locale.ROOT, "%.1f m", mc.player.getEyePosition().distanceTo(closest(e, mc.player.getEyePosition())));
		}));
		l.add(line("helditem", "Held Item Name", "hand", "The name of the item in your hand.", "", Module.Anchor.BOTTOM, -40, -70, (mc, p) -> {
			if (mc == null || mc.player.getMainHandItem().isEmpty()) return p || mc == null ? "Diamond Sword" : null;
			return mc.player.getMainHandItem().getHoverName().getString();
		}));
		l.add(line("heldcount", "Held Item Total", "chest", "How many of the item in your hand you carry in total.", "Total", Module.Anchor.BOTTOM, 98, -104, (mc, p) -> {
			if (mc == null || mc.player.getMainHandItem().isEmpty()) return p || mc == null ? "192" : null;
			return Integer.toString(count(mc, mc.player.getMainHandItem().getItem()));
		}));
		l.add(line("freeslots", "Free Slots", "chest", "How many empty slots your inventory has.", "Free", L, 4, 0, (mc, p) -> {
			if (mc == null) return "11";
			int n = 0;
			for (int i = 0; i < 36; i++) if (mc.player.getInventory().getItem(i).isEmpty()) n++;
			return Integer.toString(n);
		}));
		l.add(line("xppoints", "XP Points", "xp", "All the experience points you have.", "XP", L, 4, 0, (mc, p) -> Integer.toString(mc == null ? 1395 : mc.player.totalExperience)));
		l.add(line("xpneeded", "XP to Next Level", "xp", "How many points until your next level.", "Next lvl", L, 4, 0, (mc, p) -> {
			if (mc == null) return "37";
			int need = mc.player.getXpNeededForNextLevel();
			return Integer.toString(Math.max(0, Math.round(need * (1 - mc.player.experienceProgress))));
		}));
		l.add(line("air", "Air Left", "air", "Seconds of air left under water.", "Air", C, -60, 56, (mc, p) -> {
			if (mc == null || mc.player.getAirSupply() >= mc.player.getMaxAirSupply()) return p || mc == null ? "9 s" : null;
			return Math.max(0, mc.player.getAirSupply() / 20) + " s";
		}));
		l.add(line("freeze", "Freezing", "freeze", "How frozen you are in powder snow.", "Frozen", C, -60, 68, (mc, p) -> {
			if (mc == null || mc.player.getTicksFrozen() <= 0) return p || mc == null ? "40%" : null;
			return Math.round(100f * mc.player.getTicksFrozen() / Math.max(1, mc.player.getTicksRequiredToFreeze())) + "%";
		}));
		l.add(line("movestate", "Movement State", "sprint", "Whether you are sprinting, sneaking, swimming, flying or walking.", "", L, 4, 0, (mc, p) -> {
			if (mc == null) return "Sprinting";
			var pl = mc.player;
			if (pl.isFallFlying()) return "Flying (elytra)";
			if (pl.getAbilities().flying) return "Flying";
			if (pl.isSwimming()) return "Swimming";
			if (pl.isPassenger()) return "Riding";
			if (pl.isShiftKeyDown()) return mc.options.toggleCrouch().get() ? "Sneaking (toggled)" : "Sneaking";
			if (pl.isSprinting()) return mc.options.toggleSprint().get() ? "Sprinting (toggled)" : "Sprinting";
			return pl.getDeltaMovement().horizontalDistanceSqr() > 1e-4 ? "Walking" : "Standing";
		}));
		l.add(line("gamemode", "Game Mode", "gamemode", "Survival, creative, adventure or spectator.", "Mode", TR, -110, 0, (mc, p) -> mc == null || mc.gameMode == null ? "Survival" : OptionFeature.pretty(mc.gameMode.getPlayerMode().name())));
		l.add(line("difficulty", "Difficulty", "difficulty", "The world's difficulty.", "Difficulty", TR, -110, 0, (mc, p) -> mc == null ? "Hard" : OptionFeature.pretty(mc.level.getDifficulty().name())));
		l.add(line("servername", "Server Name", "server", "The name you gave the server in your list.", "", TR, -110, 0, (mc, p) -> mc == null ? "My Server" : mc.getCurrentServer() == null ? "Singleplayer" : mc.getCurrentServer().name));
		l.add(line("dimension", "Dimension", "dimension", "Overworld, Nether or End.", "", TR, -110, 0, (mc, p) -> mc == null ? "Overworld" : OptionFeature.pretty(V.keyPath(mc.level.dimension()).replace("the_", ""))));
		l.add(line("lightlevels", "Sky & Block Light", "bulb", "The sky light and the block (torch) light where you stand.", "Light", L, 4, 0, (mc, p) -> {
			if (mc == null) return "sky 15  block 7";
			BlockPos b = mc.player.blockPosition();
			return "sky " + mc.level.getBrightness(LightLayer.SKY, b) + "  block " + mc.level.getBrightness(LightLayer.BLOCK, b);
		}));
		l.add(line("spawnwarn", "Mob Spawn Warning", "warning", "Warns when it is dark enough where you stand for monsters to spawn.", "", C, -40, 80, (mc, p) -> {
			if (mc == null) return "Mobs can spawn here";
			if (!V.keyPath(mc.level.dimension()).equals("overworld")) return p ? "Mobs can spawn here" : null;
			return mc.level.getBrightness(LightLayer.BLOCK, mc.player.blockPosition()) == 0 ? "Mobs can spawn here" : p ? "Mobs can spawn here" : null;
		}));
		l.add(line("datetime", "Date and Time", "date", "Today's date and the time, together.", "", TR, -110, 0, (mc, p) -> LocalDateTime.now().format(DateTimeFormatter.ofPattern("EEE d MMM  HH:mm", Locale.ROOT))));
		l.add(line("hits", "Hit Counter", "hitmarker", "How many of your hits landed this session.", "Hits", L, 4, 0, (mc, p) -> Integer.toString(mc == null ? 214 : Features3.HitTracker.hits)));
		l.add(line("crits", "Crit Counter", "combo", "How many critical hits you landed this session.", "Crits", L, 4, 0, (mc, p) -> Integer.toString(mc == null ? 57 : Features3.HitTracker.crits)));
		l.add(line("accuracy", "Hit Accuracy", "accuracy", "How many of your attacks landed this session, in %.", "Accuracy", L, 4, 0, (mc, p) -> {
			if (mc == null) return "78%";
			int s = Features3.HitTracker.swings;
			return s == 0 ? "-" : Math.round(100f * Features3.HitTracker.hits / s) + "%";
		}));
		l.add(line("bestcombo", "Best Combo", "combo", "Your longest combo this session.", "Best", L, 4, 0, (mc, p) -> Integer.toString(mc == null ? 9 : Features3.HitTracker.bestCombo)));
		l.add(line("pingstats", "Ping Low / High", "ping", "Your lowest and highest ping of the last two minutes.", "Ping", L, 4, 0, (mc, p) -> {
			if (mc == null) return "38 / 71 ms";
			int lo = Integer.MAX_VALUE, hi = -1;
			for (int v : ping) if (v > 0) {
				lo = Math.min(lo, v);
				hi = Math.max(hi, v);
			}
			return hi < 0 ? (p ? "38 / 71 ms" : null) : lo + " / " + hi + " ms";
		}));
		l.add(line("fpsstats", "FPS Low / High", "fps", "Your lowest and highest FPS of the last few seconds.", "FPS", L, 4, 0, (mc, p) -> {
			if (mc == null) return "141 / 240";
			int lo = Integer.MAX_VALUE, hi = 0;
			for (int i = 0; i < Math.min(sampleAt, SAMPLES); i++) {
				lo = Math.min(lo, fps[i]);
				hi = Math.max(hi, fps[i]);
			}
			return lo == Integer.MAX_VALUE ? "-" : lo + " / " + hi;
		}));
		l.add(line("direction", "Direction Name", "compass", "Which way you face, in words (\"North-East\").", "", L, 4, 0, (mc, p) -> {
			if (mc == null) return "North-East";
			float yaw = ((mc.player.getYRot() % 360) + 360) % 360;
			return DIRS[Math.round(yaw / 45f) % 8];
		}));
		l.add(line("fullmoon", "Days to Full Moon", "moon", "How many nights until the next full moon.", "Full moon in", TR, -110, 0, (mc, p) -> {
			long day = mc == null ? 3 : V.dayTime(mc) / 24000;
			long d = (8 - day % 8) % 8;
			return d == 0 ? "tonight" : d + (d == 1 ? " day" : " days");
		}));
		l.add(line("totemwarn", "No Totem Warning", "totem", "Warns when your off hand has no totem of undying.", "", C, -40, 92, (mc, p) -> {
			if (mc == null) return "No totem in your off hand!";
			return mc.player.getOffhandItem().is(Items.TOTEM_OF_UNDYING) ? (p ? "No totem in your off hand!" : null) : "No totem in your off hand!";
		}));
		l.add(line("mountspeed", "Mount Speed", "horse", "How fast your horse, boat or minecart goes.", "Mount", L, 4, 0, (mc, p) -> {
			if (mc == null || mc.player.getVehicle() == null) return p || mc == null ? "11.2 b/s" : null;
			Vec3 v = mc.player.getVehicle().getDeltaMovement();
			return String.format(Locale.ROOT, "%.1f b/s", Math.sqrt(v.x * v.x + v.z * v.z) * 20);
		}));
		l.add(line("mounthealth", "Mount Health", "horse", "Your horse's (or other mount's) health as a number.", "Mount HP", L, 4, 0, (mc, p) -> {
			if (mc == null || !(mc.player.getVehicle() instanceof LivingEntity le)) return p || mc == null ? "24 / 30" : null;
			return String.format(Locale.ROOT, "%.0f / %.0f", le.getHealth(), le.getMaxHealth());
		}));
		l.add(line("afktimer", "AFK Timer", "afk", "How long you have been away from the keyboard (shows after 30 seconds).", "AFK", C, -30, -40, (mc, p) -> {
			long s = (System.currentTimeMillis() - lastActive) / 1000;
			if (mc == null || s < 30) return p || mc == null ? "2:31" : null;
			return time(s);
		}));
		l.add(line("renderdistshow", "Render Distance Display", "render", "Your render distance, on screen.", "Render", R, -90, 0, (mc, p) -> (mc == null ? 12 : mc.options.renderDistance().get()) + " chunks"));
		l.add(line("windowsize", "Window Size", "guiscale", "The game window's size in pixels.", "Window", R, -90, 0, (mc, p) -> mc == null ? "1920 x 1080" : mc.getWindow().getWidth() + " x " + mc.getWindow().getHeight()));
		l.add(line("mcversion", "Minecraft Version", "logo", "The Minecraft version you play.", "Version", R, -90, 0, (mc, p) -> FabricLoader.getInstance().getModContainer("minecraft").map(c -> c.getMetadata().getVersion().getFriendlyString()).orElse("?")));
		l.add(line("javaversion", "Java Version", "memory", "The Java version the game runs on.", "Java", R, -90, 0, (mc, p) -> System.getProperty("java.version", "?")));
		l.add(line("modcount", "Mods Loaded", "packs", "How many mods are loaded.", "Mods", R, -90, 0, (mc, p) -> Integer.toString(FabricLoader.getInstance().getAllMods().size())));
		l.add(line("cputhreads", "CPU Threads", "memory", "How many threads your processor has.", "CPU", R, -90, 0, (mc, p) -> Runtime.getRuntime().availableProcessors() + " threads"));
		l.add(line("gameuptime", "Game Uptime", "hourglass", "How long the game has been open.", "Open for", R, -90, 0, (mc, p) -> time(java.lang.management.ManagementFactory.getRuntimeMXBean().getUptime() / 1000)));
		return l;
	}

	private static Vec3 closest(Entity e, Vec3 from) {
		var b = e.getBoundingBox();
		return new Vec3(Math.max(b.minX, Math.min(from.x, b.maxX)), Math.max(b.minY, Math.min(from.y, b.maxY)), Math.max(b.minZ, Math.min(from.z, b.maxZ)));
	}

	static int count(Minecraft mc, Item item) {
		if (mc.player == null) return 0;
		int n = 0;
		var inv = mc.player.getInventory();
		for (int i = 0; i < inv.getContainerSize(); i++) if (inv.getItem(i).is(item)) n += inv.getItem(i).getCount();
		return n;
	}

	/* ------------------------------ item counters ------------------------------ */

	static List<Module> counters() {
		List<Module> l = new ArrayList<>();
		Object[][] items = {
			{"cnt_pearl", "Ender Pearl Counter", Items.ENDER_PEARL}, {"cnt_arrow", "Arrow Counter", Items.ARROW},
			{"cnt_gapple", "Golden Apple Counter", Items.GOLDEN_APPLE}, {"cnt_egapple", "Enchanted Apple Counter", Items.ENCHANTED_GOLDEN_APPLE},
			{"cnt_crystal", "End Crystal Counter", Items.END_CRYSTAL}, {"cnt_obsidian", "Obsidian Counter", Items.OBSIDIAN},
			{"cnt_xpbottle", "XP Bottle Counter", Items.EXPERIENCE_BOTTLE}, {"cnt_rocket", "Firework Counter", Items.FIREWORK_ROCKET},
			{"cnt_cobweb", "Cobweb Counter", Items.COBWEB}, {"cnt_carrot", "Golden Carrot Counter", Items.GOLDEN_CARROT},
			{"cnt_steak", "Steak Counter", Items.COOKED_BEEF}, {"cnt_water", "Water Bucket Counter", Items.WATER_BUCKET},
			{"cnt_tnt", "TNT Counter", Items.TNT}, {"cnt_anchor", "Respawn Anchor Counter", Items.RESPAWN_ANCHOR},
			{"cnt_glowstone", "Glowstone Counter", Items.GLOWSTONE}, {"cnt_blocks", "Block Counter", null},
		};
		int i = 0;
		for (Object[] it : items) l.add(new ItemCount((String) it[0], (String) it[1], (Item) it[2], i++));
		return l;
	}

	/** How many of one item (or of all blocks) you carry, with the item's picture. */
	static final class ItemCount extends Module {
		private final Item item;
		private final Opt.Bool hideNone = opt(new Opt.Bool("hideNone", "Hide when you have none", true));
		private final Opt.Bool background = opt(new Opt.Bool("background", "Background", true));
		private final Opt.Num warn = opt(new Opt.Num("warn", "Red when fewer than", 0, 64, 1, 4, ""));
		private final Opt.Bool stacks = opt(new Opt.Bool("stacks", "As stacks (2x64 + 5)", false));

		ItemCount(String id, String name, Item item, int n) {
			super(id, name, Cat.HUD, "itemcount", item == null ? "How many blocks you carry, all kinds together." : "How many you carry, with the item's picture.", true, false, Anchor.BOTTOM, 98 + (n % 4) * 34, -120 - (n / 4) * 20);
			this.item = item;
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			int n = 0;
			ItemStack show = item == null ? new ItemStack(Items.COBBLESTONE) : new ItemStack(item);
			if (mc.player != null) {
				var inv = mc.player.getInventory();
				for (int i = 0; i < inv.getContainerSize(); i++) {
					ItemStack s = inv.getItem(i);
					if (item == null ? s.getItem() instanceof BlockItem : s.is(item)) n += s.getCount();
				}
			}
			if (preview && n == 0) n = 16;
			if (n == 0 && hideNone.value && !preview) return;
			String t = stacks.value && n >= 64 ? (n / 64) + "x64" + (n % 64 > 0 ? "+" + n % 64 : "") : Integer.toString(n);
			int w = 20 + Draw.font().width(t) + 4;
			if (background.value) Draw.round(g, 0, 0, w, 20, 3, 0x73000000);
			g.item(show, 2, 2);
			g.text(Draw.font(), t, 20, 6, n < warn.value ? 0xFFFF5555 : 0xFFFFFFFF, true);
			lastW = w;
			lastH = 20;
		}
	}

	/* ------------------------------ drawn displays ------------------------------ */

	/** FPS (kind 0) or ping (1) over the last 6 seconds as bars. */
	static final class Graph extends Module {
		private final int kind;
		private final Opt.Num gw = opt(new Opt.Num("w", "Width", 60, 240, 10, 120, ""));
		private final Opt.Num gh = opt(new Opt.Num("h", "Height", 16, 80, 2, 30, ""));
		private final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFF55FF55));
		private final Opt.Bool coloured = opt(new Opt.Bool("coloured", "Green / yellow / red by value", true));
		private final Opt.Bool number = opt(new Opt.Bool("number", "Number on top", true));
		private final Opt.Bool background = opt(new Opt.Bool("background", "Background", true));

		Graph(String id, String name, String icon, String desc, int kind) {
			super(id, name, Cat.HUD, icon, desc, true, false, Anchor.TOP_RIGHT, -130, 60 + kind * 40);
			this.kind = kind;
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			int w = (int) gw.value, h = (int) gh.value;
			int[] d = kind == 0 ? fps : ping;
			int n = Math.min(SAMPLES, Math.max(1, sampleAt));
			int max = 1;
			for (int i = 0; i < n; i++) max = Math.max(max, d[i]);
			if (background.value) Draw.round(g, 0, 0, w, h, 2, 0x73000000);
			int bars = Math.min(n, w / 2);
			for (int i = 0; i < bars; i++) {
				int v = d[Math.floorMod(sampleAt - bars + i, SAMPLES)];
				if (preview && sampleAt == 0) v = 60 + (int) (Math.sin(i * 0.4) * 30);
				int bh = Math.max(1, Math.round((h - 2) * Math.min(1f, v / (float) Math.max(max, preview ? 100 : 1))));
				int c = color.value;
				if (coloured.value) c = kind == 0 ? (v >= 60 ? 0xFF55FF55 : v >= 30 ? 0xFFFFFF55 : 0xFFFF5555) : (v <= 80 ? 0xFF55FF55 : v <= 150 ? 0xFFFFFF55 : 0xFFFF5555);
				g.fill(w - 1 - (bars - i) * 2, h - 1 - bh, w - (bars - i) * 2, h - 1, c);
			}
			if (number.value) {
				int v = d[Math.floorMod(sampleAt - 1, SAMPLES)];
				Draw.text(g, (kind == 0 ? v + " FPS" : (v < 0 ? "-" : v + " ms")), 3, 2, 0.75f, 0xFFFFFFFF, true);
			}
			lastW = w;
			lastH = h;
		}
	}

	/** Your main inventory (the 27 slots above the hotbar) on screen. */
	static final class InventoryHud extends Module {
		private final Opt.Bool background = opt(new Opt.Bool("background", "Background", true));
		private final Opt.Bool slots = opt(new Opt.Bool("slots", "Slot squares", true));
		private final Opt.Bool hotbar = opt(new Opt.Bool("hotbar", "Hotbar row too", false));
		private final Opt.Bool hideEmpty = opt(new Opt.Bool("hideEmpty", "Hide when the inventory is empty", false));

		InventoryHud() {
			super("invhud", "Inventory HUD", Cat.HUD, "chest", "Your inventory on screen, so you see what you carry without opening it.", true, false, Anchor.BOTTOM_RIGHT, -170, -80);
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			int rows = hotbar.value ? 4 : 3;
			int w = 9 * 18 + 4, h = rows * 18 + 4;
			boolean any = false;
			if (mc.player != null) for (int i = 9; i < 36; i++) if (!mc.player.getInventory().getItem(i).isEmpty()) any = true;
			if (!any && hideEmpty.value && !preview) return;
			if (background.value) Draw.round(g, 0, 0, w, h, 3, 0x73000000);
			for (int r = 0; r < rows; r++) {
				for (int c = 0; c < 9; c++) {
					int slot = r < 3 ? 9 + r * 9 + c : c;
					int x = 2 + c * 18, y = 2 + r * 18;
					if (slots.value) g.fill(x, y, x + 17, y + 17, 0x33FFFFFF);
					if (mc.player == null) continue;
					ItemStack s = mc.player.getInventory().getItem(slot);
					if (s.isEmpty()) continue;
					g.item(s, x, y);
					g.itemDecorations(Draw.font(), s, x, y);
				}
			}
			lastW = w;
			lastH = h;
		}
	}

	/** "+16 Cobblestone" when items come into your inventory (and, if you want, "-1 Ender Pearl" when they leave). */
	static final class Pickups extends Module {
		private final Opt.Bool losses = opt(new Opt.Bool("losses", "Also when items leave", false));
		private final Opt.Num seconds = opt(new Opt.Num("seconds", "Shown for", 1, 10, 0.5, 3, " s"));
		private final Opt.Num max = opt(new Opt.Num("max", "Most lines", 1, 10, 1, 5, ""));
		private final Map<Item, Integer> last = new HashMap<>();
		private final List<Object[]> shown = new ArrayList<>(); // {Item, Integer delta, Long time}
		private int settle;

		Pickups() {
			super("pickups", "Item Pickups", Cat.HUD, "pickup", "Shows \"+16 Cobblestone\" for a moment when you pick something up.", true, false, Anchor.RIGHT, -110, 20);
		}

		void track(Minecraft mc) {
			if (!enabled) return;
			Map<Item, Integer> now = new HashMap<>();
			var inv = mc.player.getInventory();
			for (int i = 0; i < inv.getContainerSize(); i++) {
				ItemStack s = inv.getItem(i);
				if (!s.isEmpty()) now.merge(s.getItem(), s.getCount(), Integer::sum);
			}
			ItemStack carried = mc.player.containerMenu == null ? ItemStack.EMPTY : mc.player.containerMenu.getCarried();
			if (!carried.isEmpty()) now.merge(carried.getItem(), carried.getCount(), Integer::sum); // held on the mouse
			if (settle > 0 || last.isEmpty()) {
				settle = Math.max(0, settle - 1);
			} else {
				long t = System.currentTimeMillis();
				for (var e : now.entrySet()) {
					int d = e.getValue() - last.getOrDefault(e.getKey(), 0);
					if (d > 0 || (d < 0 && losses.value)) add(e.getKey(), d, t);
				}
				if (losses.value) for (var e : last.entrySet()) if (!now.containsKey(e.getKey())) add(e.getKey(), -e.getValue(), t);
			}
			last.clear();
			last.putAll(now);
		}

		private void add(Item it, int d, long t) {
			for (Object[] o : shown) {
				if (o[0] == it && Integer.signum((Integer) o[1]) == Integer.signum(d) && t - (Long) o[2] < 1500) {
					o[1] = (Integer) o[1] + d;
					o[2] = t;
					return;
				}
			}
			shown.add(new Object[] {it, d, t});
		}

		@Override
		public void onEnable(Minecraft mc) {
			last.clear();
			settle = 20;
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			long now = System.currentTimeMillis(), keep = (long) (seconds.value * 1000);
			for (Iterator<Object[]> it = shown.iterator(); it.hasNext();) if (now - (Long) it.next()[2] > keep) it.remove();
			List<Object[]> list = new ArrayList<>(shown);
			if (list.isEmpty() && preview) list.add(new Object[] {Items.COBBLESTONE, 16, now});
			int y = 0, w = 60;
			for (int i = Math.max(0, list.size() - (int) max.value); i < list.size(); i++) {
				Object[] o = list.get(i);
				ItemStack st = new ItemStack((Item) o[0]);
				int d = (Integer) o[1];
				String t = (d > 0 ? "+" : "") + d + " " + st.getHoverName().getString();
				double a = Math.min(1, (keep - (now - (Long) o[2])) / 400.0);
				Draw.round(g, 0, y, Draw.font().width(t) + 24, 18, 3, Draw.alpha(0xFF000000, 0.45 * a));
				g.item(st, 1, y + 1);
				g.text(Draw.font(), t, 20, y + 5, Draw.alpha(d > 0 ? 0xFF55FF55 : 0xFFFF5555, Math.max(0.05, a)), true);
				w = Math.max(w, Draw.font().width(t) + 24);
				y += 20;
			}
			lastW = w;
			lastH = Math.max(18, y - 2);
		}
	}

	/** A round clock with hands: your computer's time or the world's time. */
	static final class AnalogClock extends Module {
		private final Opt.Choice which = opt(new Opt.Choice("which", "Time", 0, "Real time", "World time"));
		private final Opt.Num size = opt(new Opt.Num("size", "Size", 20, 80, 2, 36, ""));
		private final Opt.Bool seconds = opt(new Opt.Bool("seconds", "Seconds hand", true));
		private final Opt.Color hand = opt(new Opt.Color("hand", "Hands colour", 0xFFFFFFFF));

		AnalogClock() {
			super("analogclock", "Analog Clock", Cat.HUD, "clock", "A round clock with hands (real time or the world's time).", true, false, Anchor.TOP_RIGHT, -50, 140);
		}

		private static void handLine(Gfx g, int cx, int cy, double angle, double len, int thick, int color) {
			for (double t = 0; t <= len; t += 0.5) {
				int x = (int) Math.round(cx + Math.sin(angle) * t), y = (int) Math.round(cy - Math.cos(angle) * t);
				g.fill(x, y, x + thick, y + thick, color);
			}
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			int s = (int) size.value, r = s / 2;
			Draw.round(g, 0, 0, s, s, r, 0x99000000);
			for (int i = 0; i < 12; i++) {
				double a = i * Math.PI / 6;
				int x = (int) Math.round(r + Math.sin(a) * (r - 3)), y = (int) Math.round(r - Math.cos(a) * (r - 3));
				g.fill(x, y, x + 1, y + 1, 0xCCFFFFFF);
			}
			double h, m, sec;
			if (which.value == 1 && mc.level != null) {
				long t = (V.dayTime(mc) + 6000) % 24000;
				h = t / 1000.0;
				m = (t % 1000) * 60 / 1000.0;
				sec = 0;
			} else {
				var now = java.time.LocalTime.now();
				sec = now.getSecond() + now.getNano() / 1e9;
				m = now.getMinute() + sec / 60;
				h = now.getHour() + m / 60;
			}
			handLine(g, r, r, h / 12 * 2 * Math.PI, r * 0.5, 2, hand.value);
			handLine(g, r, r, m / 60 * 2 * Math.PI, r * 0.75, 1, hand.value);
			if (seconds.value && which.value == 0) handLine(g, r, r, sec / 60 * 2 * Math.PI, r * 0.85, 1, 0xFFFF5555);
			lastW = s;
			lastH = s;
		}
	}

	/** Coordinates on several lines (X, Y and Z coloured), with the direction, biome and the other dimension's spot. */
	static final class CoordsBox extends Module {
		private final Opt.Bool facing = opt(new Opt.Bool("facing", "Direction", true));
		private final Opt.Bool biome = opt(new Opt.Bool("biome", "Biome", true));
		private final Opt.Bool other = opt(new Opt.Bool("other", "Nether / overworld spot", true));
		private final Opt.Bool decimals = opt(new Opt.Bool("decimals", "Decimals", false));
		private final Opt.Color axis = opt(new Opt.Color("axis", "X Y Z colour", 0xFF55FFFF));

		CoordsBox() {
			super("coordsbox", "Coordinates Box", Cat.HUD, "coordinates", "Coordinates on separate lines, with the direction, biome and the matching Nether or overworld spot.", true, false, Anchor.TOP_LEFT, 4, 4);
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			List<String[]> rows = new ArrayList<>();
			boolean hidden = Features5.hides(this);
			double x = 120.5, y = 64, z = -340.5;
			String dim = "overworld";
			if (mc.player != null) {
				x = mc.player.getX();
				y = mc.player.getY();
				z = mc.player.getZ();
				dim = V.keyPath(mc.level.dimension());
			}
			String f = decimals.value ? "%.1f" : "%.0f";
			rows.add(new String[] {"X", hidden ? "Hidden" : String.format(Locale.ROOT, f, Math.floor(x * (decimals.value ? 10 : 1)) / (decimals.value ? 10 : 1))});
			rows.add(new String[] {"Y", hidden ? "Hidden" : String.format(Locale.ROOT, f, y)});
			rows.add(new String[] {"Z", hidden ? "Hidden" : String.format(Locale.ROOT, f, Math.floor(z * (decimals.value ? 10 : 1)) / (decimals.value ? 10 : 1))});
			if (facing.value) {
				float yaw = mc.player == null ? 180 : ((mc.player.getYRot() % 360) + 360) % 360;
				rows.add(new String[] {"F", DIRS[Math.round(yaw / 45f) % 8]});
			}
			if (biome.value && !hidden) rows.add(new String[] {"B", mc.player == null ? "Plains" : OptionFeature.pretty(mc.level.getBiome(mc.player.blockPosition()).unwrapKey().map(V::keyPath).orElse("?"))});
			if (other.value && !hidden && !dim.equals("the_end")) {
				boolean nether = dim.equals("the_nether");
				double k = nether ? 8 : 1 / 8.0;
				rows.add(new String[] {nether ? "OW" : "N", String.format(Locale.ROOT, "%.0f %.0f", Math.floor(x * k), Math.floor(z * k))});
			}
			var font = Draw.font();
			int w = 0;
			for (String[] r : rows) w = Math.max(w, 18 + font.width(r[1]));
			w += 6;
			int h = rows.size() * 10 + 4;
			Draw.round(g, 0, 0, w, h, 3, 0x73000000);
			for (int i = 0; i < rows.size(); i++) {
				g.text(font, rows.get(i)[0], 3, 3 + i * 10, axis.value, true);
				g.text(font, rows.get(i)[1], 18, 3 + i * 10, 0xFFFFFFFF, true);
			}
			lastW = w;
			lastH = h;
		}
	}

	/** A small bar for each armor piece showing how worn it is. */
	static final class ArmorBars extends Module {
		private final Opt.Bool percent = opt(new Opt.Bool("percent", "Percent", true));

		ArmorBars() {
			super("armorbars", "Armor Durability Bars", Cat.HUD, "armor", "A bar for each piece of armor showing how worn it is.", true, false, Anchor.BOTTOM, -91 - 6 - 90, -60);
		}

		@Override
		public void render(Gfx g, Minecraft mc, boolean preview) {
			var slots = new net.minecraft.world.entity.EquipmentSlot[] {net.minecraft.world.entity.EquipmentSlot.HEAD, net.minecraft.world.entity.EquipmentSlot.CHEST, net.minecraft.world.entity.EquipmentSlot.LEGS, net.minecraft.world.entity.EquipmentSlot.FEET};
			int y = 0;
			for (var s : slots) {
				ItemStack st = mc.player == null ? ItemStack.EMPTY : mc.player.getItemBySlot(s);
				if (st.isEmpty() && preview) st = Features.withDamage(new ItemStack(Items.DIAMOND_CHESTPLATE), 0.3f);
				if (st.isEmpty() || !st.isDamageableItem()) continue;
				float f = 1 - st.getDamageValue() / (float) Math.max(1, st.getMaxDamage());
				g.item(st, 0, y);
				Draw.round(g, 18, y + 6, 40, 4, 2, 0x66000000);
				int c = f > 0.5f ? 0xFF55FF55 : f > 0.2f ? 0xFFFFFF55 : 0xFFFF5555;
				Draw.round(g, 18, y + 6, Math.max(2, Math.round(40 * f)), 4, 2, c);
				if (percent.value) g.text(Draw.font(), Math.round(f * 100) + "%", 62, y + 4, c, true);
				y += 17;
			}
			lastW = percent.value ? 86 : 60;
			lastH = Math.max(16, y - 1);
		}
	}

	/** The numbers 1-9 on the hotbar slots. */
	static final class HotbarNumbers extends Module implements Overlay {
		private final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFFB4B4B8));
		private final Opt.Bool selected = opt(new Opt.Bool("selected", "Selected slot in white", true));

		HotbarNumbers() {
			super("hotbarnums", "Hotbar Numbers", Cat.HUD, "hotbarnum", "The numbers 1 to 9 on your hotbar slots.", true, false, null, 0, 0);
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			if (mc.player == null) return;
			int left = g.guiWidth() / 2 - 91, y = g.guiHeight() - 22;
			ItemStack held = mc.player.getMainHandItem();
			for (int i = 0; i < 9; i++) {
				boolean sel = selected.value && mc.player.getInventory().getItem(i) == held && !held.isEmpty();
				Draw.text(g, Integer.toString(i + 1), left + 3 + i * 20, y + 3, 0.6f, sel ? 0xFFFFFFFF : color.value, true);
			}
		}
	}

	/** Above each hotbar item: how many of it you carry in all (when you have more than that stack). */
	static final class HotbarTotals extends Module implements Overlay {
		HotbarTotals() {
			super("hotbartotals", "Hotbar Totals", Cat.HUD, "hotbarnum", "Above each hotbar item, how many of it you carry in total.", true, false, null, 0, 0);
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			if (mc.player == null) return;
			int left = g.guiWidth() / 2 - 91, y = g.guiHeight() - 22;
			for (int i = 0; i < 9; i++) {
				ItemStack s = mc.player.getInventory().getItem(i);
				if (s.isEmpty() || s.getMaxStackSize() == 1) continue;
				int total = count(mc, s.getItem());
				if (total <= s.getCount()) continue;
				String t = Integer.toString(total);
				Draw.text(g, t, left + 11 + i * 20 - Draw.font().width(t) * 0.3f, y - 6, 0.6f, 0xFFFFFF55, true);
			}
		}
	}

	/** Numbers on the game's own bars: health over the hearts, hunger and saturation over the food, XP points over the XP bar. */
	static final class BarNumbers extends Module implements Overlay {
		private final Opt.Bool health = opt(new Opt.Bool("health", "Health over the hearts", true));
		private final Opt.Bool food = opt(new Opt.Bool("food", "Hunger and saturation over the food", true));
		private final Opt.Bool xp = opt(new Opt.Bool("xp", "XP points over the XP bar", true));
		private final Opt.Num lift = opt(new Opt.Num("lift", "Higher by", 0, 30, 1, 0, ""));

		BarNumbers() {
			super("barnumbers", "Status Bar Numbers", Cat.HUD, "heart", "Exact numbers on the game's hearts, food and XP bars.", true, false, null, 0, 0);
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			if (mc.player == null || mc.gameMode == null || !mc.gameMode.hasExperience()) return;
			int cx = g.guiWidth() / 2, top = g.guiHeight() - 39 - 9 - (int) lift.value;
			var p = mc.player;
			if (health.value) {
				String t = String.format(Locale.ROOT, "%.1f", p.getHealth()) + (p.getAbsorptionAmount() > 0 ? String.format(Locale.ROOT, " +%.0f", p.getAbsorptionAmount()) : "");
				Draw.text(g, t, cx - 91, top - (p.getAbsorptionAmount() > 0 || p.getMaxHealth() > 20 ? 10 : 0), 0.75f, 0xFFFF7777, true);
			}
			if (food.value) {
				String t = p.getFoodData().getFoodLevel() + " / " + String.format(Locale.ROOT, "%.1f", p.getFoodData().getSaturationLevel());
				Draw.text(g, t, cx + 91 - Draw.font().width(t) * 0.75f, top - (p.isPassenger() ? 10 : 0), 0.75f, 0xFFFFCC66, true);
			}
			if (xp.value && p.experienceLevel >= 0) {
				int need = p.getXpNeededForNextLevel();
				String t = Math.round(need * p.experienceProgress) + " / " + need;
				Draw.text(g, t, cx + 91 - Draw.font().width(t) * 0.6f, g.guiHeight() - 30, 0.6f, 0xFF80FF20, true);
			}
		}
	}

	/** Your own crosshair: style, size, gap, thickness, colour, outline - drawn over (or instead of) the game's one. */
	static final class Crosshair extends Module implements Overlay {
		final Opt.Choice style = opt(new Opt.Choice("style", "Style", 0, "Cross", "Dot", "Circle", "Cross + dot", "T shape", "X", "Square", "Arrow"));
		final Opt.Num size = opt(new Opt.Num("size", "Size", 1, 20, 1, 5, ""));
		final Opt.Num gap = opt(new Opt.Num("gap", "Gap", 0, 10, 1, 2, ""));
		final Opt.Num thick = opt(new Opt.Num("thick", "Thickness", 1, 4, 1, 1, ""));
		final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFF55FF55));
		final Opt.Bool rainbow = opt(new Opt.Bool("rainbow", "Rainbow", false));
		final Opt.Num opacity = opt(new Opt.Num("opacity", "Opacity", 20, 100, 5, 100, "%"));
		final Opt.Bool outline = opt(new Opt.Bool("outline", "Dark outline", true));
		final Opt.Bool hideGame = opt(new Opt.Bool("hideGame", "Hide the game's crosshair (1.21.6 and newer)", true));
		final Opt.Bool redOnTarget = opt(new Opt.Bool("redOnTarget", "Red when on a mob or player", false));
		final Opt.Bool thirdPerson = opt(new Opt.Bool("thirdPerson", "Also in third person", false));

		Crosshair() {
			super("customcrosshair", "Custom Crosshair", Cat.VISUAL, "crosshair", "Your own crosshair: 8 styles, any size, gap, thickness and colour.", true, false, null, 0, 0);
		}

		boolean showing(Minecraft mc) {
			return enabled && mc.player != null && (thirdPerson.value || mc.options.getCameraType().isFirstPerson());
		}

		private void bar(Gfx g, int x1, int y1, int x2, int y2, int c) {
			if (outline.value) g.fill(x1 - 1, y1 - 1, x2 + 1, y2 + 1, Draw.alpha(0xFF000000, ((c >>> 24) & 0xFF) / 255.0 * 0.7));
			g.fill(x1, y1, x2, y2, c);
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			if (!showing(mc) || V.debugShown(mc)) return;
			int cx = g.guiWidth() / 2, cy = g.guiHeight() / 2;
			int c = rainbow.value ? Draw.rainbow(0.3f, 0) : color.value;
			if (redOnTarget.value && mc.crosshairPickEntity != null) c = 0xFFFF4040;
			c = Draw.alpha(c, opacity.value / 100.0);
			int s = (int) size.value, gp = (int) gap.value, t = (int) thick.value, h0 = t / 2, h1 = t - h0;
			switch (style.value) {
				case 1 -> bar(g, cx - h0 - (s > 3 ? 1 : 0), cy - h0 - (s > 3 ? 1 : 0), cx + h1 + (s > 3 ? 1 : 0), cy + h1 + (s > 3 ? 1 : 0), c);
				case 2 -> {
					for (int a = 0; a < 48; a++) {
						double ang = a * Math.PI * 2 / 48;
						int x = (int) Math.round(cx + Math.cos(ang) * (s + gp)), y = (int) Math.round(cy + Math.sin(ang) * (s + gp));
						g.fill(x - h0, y - h0, x + h1, y + h1, c);
					}
				}
				case 5 -> {
					for (int i = gp; i <= gp + s; i++) {
						g.fill(cx + i - h0, cy + i - h0, cx + i + h1, cy + i + h1, c);
						g.fill(cx - i - h0, cy + i - h0, cx - i + h1, cy + i + h1, c);
						g.fill(cx + i - h0, cy - i - h0, cx + i + h1, cy - i + h1, c);
						g.fill(cx - i - h0, cy - i - h0, cx - i + h1, cy - i + h1, c);
					}
				}
				case 6 -> {
					int o = gp + s;
					bar(g, cx - o, cy - o, cx + o + 1, cy - o + t, c);
					bar(g, cx - o, cy + o + 1 - t, cx + o + 1, cy + o + 1, c);
					bar(g, cx - o, cy - o + t, cx - o + t, cy + o + 1 - t, c);
					bar(g, cx + o + 1 - t, cy - o + t, cx + o + 1, cy + o + 1 - t, c);
				}
				case 7 -> {
					for (int i = 0; i <= s; i++) {
						g.fill(cx - i - h0, cy + gp + i - h0, cx - i + h1, cy + gp + i + h1, c);
						g.fill(cx + i - h0, cy + gp + i - h0, cx + i + h1, cy + gp + i + h1, c);
					}
				}
				default -> {
					boolean top = style.value != 4;
					bar(g, cx - h0 - gp - s, cy - h0, cx - h0 - gp, cy + h1, c);
					bar(g, cx + h1 + gp, cy - h0, cx + h1 + gp + s, cy + h1, c);
					if (top) bar(g, cx - h0, cy - h0 - gp - s, cx + h1, cy - h0 - gp, c);
					bar(g, cx - h0, cy + h1 + gp, cx + h1, cy + h1 + gp + s, c);
					if (style.value == 3) bar(g, cx - h0, cy - h0, cx + h1, cy + h1, c);
				}
			}
		}
	}

	/** Hooks the game's crosshair so Custom Crosshair can hide it (where the Fabric API allows). */
	static void registerCrosshair() {
		try {
			V.hideCrosshair(() -> {
				Minecraft mc = Minecraft.getInstance();
				return Panel.byId("customcrosshair") instanceof Crosshair c && c.showing(mc) && c.hideGame.value && !Panel.hudHidden;
			});
		} catch (Throwable ignored) {
			// the game's crosshair just stays
		}
	}

	/** The screen's edges glow red when your health is low. */
	static final class LowHealthGlow extends Module implements Overlay {
		private final Opt.Num at = opt(new Opt.Num("at", "At or below", 1, 20, 1, 6, " HP"));
		private final Opt.Num strength = opt(new Opt.Num("strength", "Strength", 10, 100, 5, 60, "%"));
		private final Opt.Bool pulse = opt(new Opt.Bool("pulse", "Pulse", true));
		private final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFFFF5555));

		LowHealthGlow() {
			super("lowhpglow", "Low Health Glow", Cat.VISUAL, "lowhpglow", "The edges of the screen glow red when your health is low.", true, false, null, 0, 0);
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			if (mc.player == null || mc.player.getHealth() > at.value || mc.player.isDeadOrDying()) return;
			double k = strength.value / 100.0 * (pulse.value ? 0.6 + 0.4 * Math.sin(System.currentTimeMillis() / 200.0) : 1);
			edges(g, color.value, k);
		}
	}

	static void edges(Gfx g, int color, double k) {
		int w = g.guiWidth(), h = g.guiHeight(), n = 14;
		for (int i = 0; i < n; i++) {
			int c = Draw.alpha(color, k * 0.55 * (1 - i / (double) n));
			int d = i * 3;
			g.fill(d, d, w - d, d + 3, c);
			g.fill(d, h - d - 3, w - d, h - d, c);
			g.fill(d, d + 3, d + 3, h - d - 3, c);
			g.fill(w - d - 3, d + 3, w - d, h - d - 3, c);
		}
	}

	/** A short red flash when you take damage. */
	static final class DamageFlash extends Module implements Overlay {
		private final Opt.Num strength = opt(new Opt.Num("strength", "Strength", 10, 100, 5, 40, "%"));
		private final Opt.Choice kind = opt(new Opt.Choice("kind", "Look", 0, "Edges", "Whole screen"));
		private final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFFFF5555));
		private static float lastHealth = -1;
		private static long hitAt;

		DamageFlash() {
			super("damageflash", "Damage Flash", Cat.VISUAL, "damageflash", "The screen flashes red for a moment when you get hurt.", true, false, null, 0, 0);
		}

		static void tickHealth(Minecraft mc) {
			float h = mc.player.getHealth();
			if (lastHealth >= 0 && h < lastHealth && h > 0) hitAt = System.currentTimeMillis();
			lastHealth = h;
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			long d = System.currentTimeMillis() - hitAt;
			if (d > 400) return;
			double k = strength.value / 100.0 * (1 - d / 400.0);
			if (kind.value == 1) g.fill(0, 0, g.guiWidth(), g.guiHeight(), Draw.alpha(color.value, k * 0.5));
			else edges(g, color.value, k * 1.6);
		}
	}

	/** A see-through colour over the game: warm (easier on the eyes at night), cool, sepia or your own colour. */
	static final class ColorFilter extends Module implements Overlay {
		private final Opt.Choice preset = opt(new Opt.Choice("preset", "Filter", 0, "Warm (night light)", "Cool", "Sepia", "Dark", "Own colour"));
		private final Opt.Color own = opt(new Opt.Color("own", "Own colour", 0xFF5599FF));
		private final Opt.Num strength = opt(new Opt.Num("strength", "Strength", 5, 60, 5, 20, "%"));

		ColorFilter() {
			super("colorfilter", "Colour Filter", Cat.VISUAL, "filter", "A see-through colour over the game, like a night light that is easier on your eyes.", true, false, null, 0, 0);
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			int c = switch (preset.value) {
				case 1 -> 0xFF3366FF;
				case 2 -> 0xFF704214;
				case 3 -> 0xFF000000;
				case 4 -> own.value;
				default -> 0xFFFF8A00;
			};
			g.fill(0, 0, g.guiWidth(), g.guiHeight(), Draw.alpha(c, strength.value / 100.0));
		}
	}

	/* ------------------------------ savers and reminders ------------------------------ */

	/** Fewer frames while the game is in the background (saves power and keeps your PC cool). */
	static final class UnfocusedFps extends Module {
		private final Opt.Num limit = opt(new Opt.Num("limit", "FPS in the background", 5, 60, 5, 15, " FPS"));
		private Integer before;

		UnfocusedFps() {
			super("unfocusedfps", "Background FPS Saver", Cat.PERFORMANCE, "sleep", "The game runs at a low frame rate while you're tabbed out, and at full speed again when you come back.", true, false, null, 0, 0);
		}

		@Override
		public void tick(Minecraft mc) {
			boolean away = !mc.isWindowActive();
			if (away && before == null) {
				before = mc.options.framerateLimit().get();
				mc.options.framerateLimit().set((int) limit.value);
				holdingFps = true;
			} else if (!away && before != null) {
				onDisable(mc);
			}
		}

		@Override
		public void onDisable(Minecraft mc) {
			if (before != null) mc.options.framerateLimit().set(before);
			before = null;
			holdingFps = false;
		}
	}

	/** Fewer frames when you've been AFK for a while. */
	static final class AfkFps extends Module {
		private final Opt.Num after = opt(new Opt.Num("after", "After", 1, 30, 1, 3, " min"));
		private final Opt.Num limit = opt(new Opt.Num("limit", "FPS while AFK", 5, 60, 5, 10, " FPS"));
		private Integer before;

		AfkFps() {
			super("afkfps", "AFK FPS Saver", Cat.PERFORMANCE, "afk", "The game runs at a low frame rate when you've been away for a few minutes (back to normal when you move).", true, false, null, 0, 0);
		}

		@Override
		public void tick(Minecraft mc) {
			boolean afk = mc.player != null && System.currentTimeMillis() - lastActive > after.value * 60000;
			if (afk && before == null) {
				before = mc.options.framerateLimit().get();
				mc.options.framerateLimit().set((int) limit.value);
				holdingFps = true;
			} else if (!afk && before != null) {
				onDisable(mc);
			}
		}

		@Override
		public void onDisable(Minecraft mc) {
			if (before != null) mc.options.framerateLimit().set(before);
			before = null;
			holdingFps = false;
		}
	}

	/** No sound while you're tabbed out. The volume from before is kept with the profile, so it always comes back. */
	static final class MuteBackground extends Module {
		private final Opt.Num volume = opt(new Opt.Num("volume", "Volume in the background", 0, 50, 5, 0, "%"));

		MuteBackground() {
			super("mutebg", "Mute in Background", Cat.UTILITY, "speaker_off", "The game goes quiet while you're tabbed out, and the sound comes back when you return.", true, false, null, 0, 0);
		}

		private static net.minecraft.client.OptionInstance<Double> master(Minecraft mc) {
			return mc.options.getSoundSourceOptionInstance(SoundSource.MASTER);
		}

		@Override
		public void tick(Minecraft mc) {
			boolean away = !mc.isWindowActive();
			if (away && restore == null) {
				restore = Double.toString(master(mc).get());
				master(mc).set(volume.value / 100.0);
				holdingVolume = true;
			} else if (!away && restore != null) {
				onDisable(mc);
			}
		}

		@Override
		public void onEnable(Minecraft mc) {
			if (restore != null && mc.isWindowActive()) onDisable(mc); // the game closed while muted
		}

		@Override
		public void onDisable(Minecraft mc) {
			if (restore != null) {
				try {
					master(mc).set(Double.parseDouble(restore));
				} catch (RuntimeException ignored) {
					// keep what it is
				}
			}
			restore = null;
			holdingVolume = false;
		}
	}

	/** Your own reminder ("Drink water!") in the middle of the screen every few minutes. */
	static final class Reminders extends Module implements Overlay {
		private final Opt.Text text = opt(new Opt.Text("text", "Reminder", "Drink some water!", 60));
		private final Opt.Num every = opt(new Opt.Num("every", "Every", 1, 120, 1, 30, " min"));
		private final Opt.Num seconds = opt(new Opt.Num("seconds", "Shown for", 2, 20, 1, 5, " s"));
		private final Opt.Bool sound = opt(new Opt.Bool("sound", "Sound", true));
		private final Opt.Color color = opt(new Opt.Color("color", "Colour", 0xFFFFFF55));
		private long started = System.currentTimeMillis(), shownAt = -1;

		Reminders() {
			super("reminders", "Reminders", Cat.UTILITY, "bell", "Your own reminder in the middle of the screen every few minutes, like \"Drink some water!\".", true, false, null, 0, 0);
		}

		@Override
		public void onEnable(Minecraft mc) {
			started = System.currentTimeMillis();
		}

		@Override
		public void tick(Minecraft mc) {
			long now = System.currentTimeMillis(), per = (long) (every.value * 60000);
			if (now - started >= per) {
				started = now;
				shownAt = now;
				if (sound.value && mc.player != null) ChatHooks.ding(mc, 1, 70);
			}
		}

		@Override
		public void overlay(Gfx g, Minecraft mc) {
			if (shownAt < 0 || System.currentTimeMillis() - shownAt > seconds.value * 1000) return;
			int w = g.guiWidth();
			int tw = Draw.font().width(text.value) * 2 + 20;
			Draw.round(g, w / 2 - tw / 2, 40, tw, 28, 5, 0xAA000000);
			Draw.centered(g, text.value, w / 2f, 47, 2f, color.value);
		}
	}

	/** Shows or hides one layer of your skin (cape, jacket, sleeves, pants, hat) - the game's own Skin Customization. */
	static final class SkinPart extends Module {
		private final PlayerModelPart part;

		SkinPart(String id, String name, PlayerModelPart part) {
			super(id, name, Cat.VISUAL, "skin", "The game's own skin setting: everyone sees it (it's in Skin Customization too).", true, false, null, 0, 0);
			this.part = part;
		}

		@Override
		public void onEnable(Minecraft mc) {
			V.setModelPart(mc.options, part, false);
			mc.options.save();
		}

		@Override
		public void onDisable(Minecraft mc) {
			V.setModelPart(mc.options, part, true);
			mc.options.save();
		}
	}
}
