package com.wxsted.reminthhud.client.panel;

import java.lang.reflect.Method;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.wxsted.reminthhud.ReminthHud;

import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.TextColor;

/**
 * Tier Tagger (on by default): players' PvP tiers from the public tier lists, in front of their names above their heads and in the tab
 * list (mixin/TierNameMixin, mixin/TierTabMixin), and /tiers <name> for everything one player has.
 *
 * Tier lists read (10 Oct 2026): MCTiers (mctiers.com, the official TierTagger's API - its domain is down right now,
 * it starts working again by itself), PvPTiers (pvptiers.com, the API its own website uses), SubTiers (subtiers.net).
 * All three answer {rankings: {mode: {tier 1-5, pos 0 = high / 1 = low, retired}}}. Each player is asked about once
 * per 30 minutes per list; players of offline-mode servers (no real Minecraft account id) are never looked up.
 */
public final class TierTagger extends Module {
	enum Site {
		MCTIERS("MCTiers", "https://mctiers.com/api/v2/profile/", true), PVPTIERS("PvPTiers", "https://pvptiers.com/api/profile/", false), SUBTIERS("SubTiers", "https://subtiers.net/api/v2/profile/", true);

		final String title;
		final String url;
		final boolean dashed;

		Site(String title, String url, boolean dashed) {
			this.title = title;
			this.url = url;
			this.dashed = dashed;
		}
	}

	/** One tier of one player in one mode on one list. */
	record Rank(Site site, String mode, int tier, boolean high, boolean retired) {
		int score() {
			return (6 - tier) * 2 + (high ? 1 : 0);
		}

		String label() {
			return (high ? "HT" : "LT") + tier;
		}
	}

	private static final class Entry {
		volatile List<Rank> ranks; // null: not loaded (yet / failed)
		volatile long at;
		volatile boolean pending;
		volatile boolean failed;
	}

	static final String[] MODE_CHOICES = {"Best tier", "Crystal", "Sword", "UHC", "Pot", "Netherite Pot", "SMP", "Axe", "Mace", "Elytra"};
	private static final String[][] MODE_KEYS = {null, {"crystal", "vanilla"}, {"sword"}, {"uhc"}, {"pot"}, {"neth_pot", "nethpot", "nethop"}, {"smp"}, {"axe"}, {"mace"}, {"elytra"}};
	private static final Map<String, String> MODE_NAMES = Map.ofEntries(Map.entry("crystal", "Crystal"), Map.entry("vanilla", "Crystal"), Map.entry("sword", "Sword"), Map.entry("uhc", "UHC"),
		Map.entry("pot", "Pot"), Map.entry("neth_pot", "NethPot"), Map.entry("nethop", "NethPot"), Map.entry("smp", "SMP"), Map.entry("axe", "Axe"), Map.entry("mace", "Mace"),
		Map.entry("elytra", "Elytra"), Map.entry("trident", "Trident"), Map.entry("bed", "Bed"), Map.entry("minecart", "Minecart"), Map.entry("creeper", "Creeper"),
		Map.entry("dia_smp", "Dia SMP"), Map.entry("dia_crystal", "Dia Crystal"), Map.entry("manhunt", "Manhunt"), Map.entry("og_vanilla", "OG Vanilla"), Map.entry("speed", "Speed"),
		Map.entry("bow", "Bow"), Map.entry("debuff", "DeBuff"));

	private static final long FRESH_MS = 30 * 60 * 1000L;
	private static final long RETRY_MS = 2 * 60 * 1000L;
	private static final Map<String, Entry> CACHE = new ConcurrentHashMap<>();
	private static final Semaphore IN_FLIGHT = new Semaphore(6);
	private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).followRedirects(HttpClient.Redirect.NORMAL)
		.executor(Executors.newFixedThreadPool(3, r -> {
			Thread t = new Thread(r, "Reminth tier tagger");
			t.setDaemon(true);
			return t;
		})).build();

	final Opt.Choice site = opt(new Opt.Choice("site", "Tier list", 0, "All lists (best)", "MCTiers", "PvPTiers", "SubTiers"));
	final Opt.Choice mode = opt(new Opt.Choice("mode", "Gamemode", 0, MODE_CHOICES));
	final Opt.Bool heads = opt(new Opt.Bool("heads", "Above heads", true));
	final Opt.Bool tab = opt(new Opt.Bool("tab", "Tab list", true));
	final Opt.Bool showMode = opt(new Opt.Bool("showmode", "Show the gamemode", true));
	final Opt.Bool retired = opt(new Opt.Bool("retired", "Show retired tiers", true));

	TierTagger() {
		super("tiertagger", "Tier Tagger", Cat.VISUAL, "tiers", "Players' PvP tiers (MCTiers, PvPTiers, SubTiers) next to their names. Type /tiers <name> for all of a player's tiers.", true, true,
			null, 0, 0);
	}

	public boolean headsOn() {
		return heads.value;
	}

	public static TierTagger get() {
		return Panel.byId("tiertagger") instanceof TierTagger t ? t : null;
	}

	// ---------- names ----------

	/** The name with the tier in front, or null to leave it as it is. Never blocks: unknown players are looked up in the background. */
	public Component decorate(UUID id, Component name) {
		if (id == null || name == null || id.version() != 4) return null;
		Rank r = pick(id);
		if (r == null) return null;
		int color = r.retired() ? 0x8A8A8A : tierColor(r);
		MutableComponent tag = Component.literal(r.label()).withStyle(s -> s.withColor(TextColor.fromRgb(color)));
		if (showMode.value) tag.append(Component.literal(" " + modeName(r.mode())).withStyle(ChatFormatting.GRAY));
		tag.append(Component.literal(" | ").withStyle(ChatFormatting.DARK_GRAY));
		return Component.empty().append(tag).append(name);
	}

	public Component decorateTab(PlayerInfo info, Component name) {
		return tab.value && info != null ? decorate(profileId(info.getProfile()), name) : null;
	}

	private Rank pick(UUID id) {
		Rank best = null;
		String[] keys = MODE_KEYS[Math.max(0, Math.min(MODE_KEYS.length - 1, mode.value))];
		for (Site s : Site.values()) {
			if (site.value != 0 && site.value != s.ordinal() + 1) continue;
			List<Rank> ranks = ranks(s, id, false);
			if (ranks == null) continue;
			for (Rank r : ranks) {
				if (r.retired() && !retired.value) continue;
				if (keys != null && !matches(r.mode(), keys)) continue;
				if (best == null || r.score() > best.score() || (r.score() == best.score() && best.retired() && !r.retired())) best = r;
			}
		}
		return best;
	}

	private static boolean matches(String mode, String[] keys) {
		for (String k : keys) if (k.equals(mode)) return true;
		return false;
	}

	private static int tierColor(Rank r) {
		return switch (r.tier()) {
			case 1 -> r.high() ? 0xFFD24A : 0xF2BE45;
			case 2 -> r.high() ? 0xEDEDF5 : 0xC9C9D6;
			case 3 -> r.high() ? 0xF0A060 : 0xD98C50;
			case 4 -> r.high() ? 0x7FC8FF : 0x67AEE0;
			default -> r.high() ? 0xB4B4B4 : 0x9A9A9A;
		};
	}

	static String modeName(String key) {
		String n = MODE_NAMES.get(key);
		if (n != null) return n;
		String s = key.replace('_', ' ');
		return s.isEmpty() ? key : Character.toUpperCase(s.charAt(0)) + s.substring(1);
	}

	// ---------- looking players up ----------

	/** The ranks on one list (cached), starting a look-up when there is none or it's old. null = nothing known yet. */
	private static List<Rank> ranks(Site s, UUID id, boolean force) {
		String key = s.name() + id;
		Entry e = CACHE.computeIfAbsent(key, k -> new Entry());
		long age = System.currentTimeMillis() - e.at;
		boolean stale = e.at == 0 || age > (e.failed ? RETRY_MS : FRESH_MS);
		if ((stale || force) && !e.pending) fetch(s, id, e);
		return e.ranks;
	}

	private static CompletableFuture<Void> fetch(Site s, UUID id, Entry e) {
		if (!IN_FLIGHT.tryAcquire()) return CompletableFuture.completedFuture(null); // busy: asked again on a later frame
		e.pending = true;
		String uuid = s.dashed ? id.toString() : id.toString().replace("-", "");
		HttpRequest req = HttpRequest.newBuilder(URI.create(s.url + uuid)).timeout(Duration.ofSeconds(10)).header("User-Agent", "Reminth (https://reminth.pages.dev)").header("Accept", "application/json").GET().build();
		return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString()).handle((res, err) -> {
			try {
				if (err != null || res == null) {
					e.failed = true;
					if (testAt > 0) ReminthHud.LOGGER.info("Tier test: {} unreachable ({})", s.title, err);
				} else if (res.statusCode() == 200) {
					e.ranks = parse(s, res.body());
					e.failed = false;
				} else if (res.statusCode() == 429 || res.statusCode() >= 500) {
					e.failed = true; // try again soon
					if (testAt > 0) ReminthHud.LOGGER.info("Tier test: {} answered {}", s.title, res.statusCode());
				} else {
					e.ranks = List.of(); // not on this list
					e.failed = false;
				}
			} catch (Throwable t) {
				e.failed = true;
			} finally {
				e.at = System.currentTimeMillis();
				e.pending = false;
				IN_FLIGHT.release();
			}
			return null;
		});
	}

	static List<Rank> parse(Site s, String body) {
		List<Rank> out = new ArrayList<>();
		JsonElement root = JsonParser.parseString(body);
		if (!root.isJsonObject()) return out;
		JsonElement rk = root.getAsJsonObject().get("rankings");
		if (rk == null || !rk.isJsonObject()) return out;
		for (Map.Entry<String, JsonElement> m : rk.getAsJsonObject().entrySet()) {
			if (!m.getValue().isJsonObject()) continue;
			JsonObject o = m.getValue().getAsJsonObject();
			if (!o.has("tier") || !o.get("tier").isJsonPrimitive()) continue;
			int tier = o.get("tier").getAsInt();
			if (tier < 1 || tier > 5) continue;
			boolean high = o.has("pos") && o.get("pos").isJsonPrimitive() && o.get("pos").getAsInt() == 0;
			boolean ret = o.has("retired") && o.get("retired").isJsonPrimitive() && o.get("retired").getAsBoolean();
			out.add(new Rank(s, m.getKey().toLowerCase(Locale.ROOT), tier, high, ret));
		}
		return out;
	}

	// GameProfile is a class with getId()/getName() up to 1.21.8 and a record with id()/name() after - found once.
	private static volatile Method profileIdMethod, profileNameMethod;

	static UUID profileId(Object profile) {
		try {
			if (profile == null) return null;
			if (profileIdMethod == null) profileIdMethod = method(profile, "id", "getId");
			return (UUID) profileIdMethod.invoke(profile);
		} catch (Throwable t) {
			return null;
		}
	}

	static String profileName(Object profile) {
		try {
			if (profile == null) return null;
			if (profileNameMethod == null) profileNameMethod = method(profile, "name", "getName");
			return (String) profileNameMethod.invoke(profile);
		} catch (Throwable t) {
			return null;
		}
	}

	private static Method method(Object o, String a, String b) throws NoSuchMethodException {
		try {
			return o.getClass().getMethod(a);
		} catch (NoSuchMethodException e) {
			return o.getClass().getMethod(b);
		}
	}

	// ---------- /tiers <name> ----------

	static void registerCommand() {
		ClientCommandRegistrationCallback.EVENT.register((dispatcher, context) -> dispatcher.register(
			LiteralArgumentBuilder.<FabricClientCommandSource>literal("tiers").then(RequiredArgumentBuilder.<FabricClientCommandSource, String>argument("player", StringArgumentType.word()).executes(c -> {
				FabricClientCommandSource src = c.getSource();
				lookup(src::sendFeedback, src::sendError, StringArgumentType.getString(c, "player"));
				return 1;
			}))));
	}

	private static void lookup(java.util.function.Consumer<Component> feedback, java.util.function.Consumer<Component> error, String name) {
		Minecraft mc = Minecraft.getInstance();
		if (!name.matches("[A-Za-z0-9_]{1,16}")) {
			error.accept(Component.literal("That isn't a Minecraft name."));
			return;
		}
		feedback.accept(Component.literal("Looking up " + name + "'s tiers...").withStyle(ChatFormatting.GRAY));
		UUID known = null;
		String shown = name;
		try {
			Collection<PlayerInfo> online = mc.getConnection() == null ? List.of() : mc.getConnection().getOnlinePlayers();
			for (PlayerInfo info : online) {
				Object profile = info.getProfile();
				String n = profileName(profile);
				if (n != null && n.equalsIgnoreCase(name)) {
					known = profileId(profile);
					shown = n;
					break;
				}
			}
		} catch (Throwable ignored) {
			// ask Mojang instead
		}
		final String display = shown;
		CompletableFuture<UUID> idF = known != null && known.version() == 4 ? CompletableFuture.completedFuture(known) : mojangId(name);
		idF.thenCompose(id -> {
			if (id == null) return CompletableFuture.completedFuture((List<Object>) null);
			List<CompletableFuture<Object>> all = new ArrayList<>();
			for (Site s : Site.values()) all.add(fetchNow(s, id).thenApply(x -> (Object) x));
			return CompletableFuture.allOf(all.toArray(new CompletableFuture[0])).thenApply(v -> {
				List<Object> r = new ArrayList<>();
				for (CompletableFuture<Object> f : all) r.add(f.join());
				return r;
			});
		}).whenComplete((results, err) -> mc.execute(() -> {
			if (err != null) {
				error.accept(Component.literal("Couldn't look that up right now. Try again in a moment."));
				return;
			}
			if (results == null) {
				error.accept(Component.literal("There's no Minecraft account called " + name + "."));
				return;
			}
			feedback.accept(Component.literal(display + "'s PvP tiers").withStyle(ChatFormatting.BOLD));
			Site[] sites = Site.values();
			for (int i = 0; i < sites.length; i++) {
				MutableComponent line = Component.literal(sites[i].title + ": ").withStyle(ChatFormatting.GRAY);
				Object r = results.get(i);
				if (!(r instanceof List<?> l)) {
					line.append(Component.literal("couldn't reach the site").withStyle(ChatFormatting.DARK_GRAY));
				} else if (l.isEmpty()) {
					line.append(Component.literal("not ranked").withStyle(ChatFormatting.DARK_GRAY));
				} else {
					List<Rank> ranks = new ArrayList<>();
					for (Object o : l) ranks.add((Rank) o);
					ranks.sort(Comparator.comparingInt(Rank::score).reversed());
					boolean first = true;
					for (Rank rk : ranks) {
						if (!first) line.append(Component.literal(", ").withStyle(ChatFormatting.DARK_GRAY));
						first = false;
						int color = rk.retired() ? 0x8A8A8A : tierColor(rk);
						line.append(Component.literal(rk.label()).withStyle(s -> s.withColor(TextColor.fromRgb(color))));
						line.append(Component.literal(" " + modeName(rk.mode()) + (rk.retired() ? " (retired)" : "")).withStyle(ChatFormatting.WHITE));
					}
				}
				feedback.accept(line);
			}
		}));
	}

	/** A fresh look-up (also fills the cache): the ranks, or null when the site couldn't be reached. */
	private static CompletableFuture<List<Rank>> fetchNow(Site s, UUID id) {
		String uuid = s.dashed ? id.toString() : id.toString().replace("-", "");
		HttpRequest req = HttpRequest.newBuilder(URI.create(s.url + uuid)).timeout(Duration.ofSeconds(10)).header("User-Agent", "Reminth (https://reminth.pages.dev)").header("Accept", "application/json").GET().build();
		return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString()).handle((res, err) -> {
			if (err != null || res == null || res.statusCode() == 429 || res.statusCode() >= 500) return null;
			List<Rank> ranks;
			try {
				ranks = res.statusCode() == 200 ? parse(s, res.body()) : List.of();
			} catch (Throwable t) {
				return null;
			}
			Entry e = CACHE.computeIfAbsent(s.name() + id, k -> new Entry());
			e.ranks = ranks;
			e.failed = false;
			e.at = System.currentTimeMillis();
			return ranks;
		});
	}

	private static CompletableFuture<UUID> mojangId(String name) {
		HttpRequest req = HttpRequest.newBuilder(URI.create("https://api.mojang.com/users/profiles/minecraft/" + name)).timeout(Duration.ofSeconds(10)).header("User-Agent", "Reminth (https://reminth.pages.dev)").GET().build();
		return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString()).thenApply(res -> {
			if (res.statusCode() != 200) return null;
			JsonElement j = JsonParser.parseString(res.body());
			if (!j.isJsonObject() || !j.getAsJsonObject().has("id")) return null;
			String h = j.getAsJsonObject().get("id").getAsString();
			if (!h.matches("[0-9a-fA-F]{32}")) return null;
			return UUID.fromString(h.replaceFirst("(.{8})(.{4})(.{4})(.{4})(.{12})", "$1-$2-$3-$4-$5"));
		});
	}

	// For Reminth's own game tests only (-Dreminthhud.testTier=<seconds of JVM uptime>, -Dreminthhud.testTierName=<name>):
	// turns the feature on, then logs the player's name as the game draws it and a /tiers look-up (singleplayer has no
	// other players and the test tool can't type).
	private static long testAt = Long.getLong("reminthhud.testTier", 0L) * 1000L;
	private static int testStep;
	private static final UUID TEST_ID = UUID.fromString("4bb70487-9146-4fc7-89ec-971808e414b9"); // michaelcycle00 (PvPTiers)

	static void testTick(Minecraft mc) {
		if (testAt <= 0 || mc.player == null) return;
		long up = java.lang.management.ManagementFactory.getRuntimeMXBean().getUptime();
		if (testStep == 0 && up >= testAt) {
			testStep = 1;
			TierTagger t = get();
			if (t != null && !t.enabled) {
				t.enabled = true;
				t.onEnable(mc);
			}
			ReminthHud.LOGGER.info("Tier test: name before = {}", mc.player.getDisplayName().getString());
			if (get() != null) get().decorate(TEST_ID, Component.literal("X")); // starts the look-up of a real ranked player
		} else if (testStep == 1 && up >= testAt + 15000) {
			testStep = 2;
			ReminthHud.LOGGER.info("Tier test: name after = {}", mc.player.getDisplayName().getString());
			TierTagger t = get();
			Component direct = t == null ? null : t.decorate(TEST_ID, Component.literal("X"));
			ReminthHud.LOGGER.info("Tier test: id {} v{} enabled {} direct = {}", mc.player.getUUID(), mc.player.getUUID().version(), t != null && t.enabled, direct == null ? "null" : direct.getString());
			lookup(c -> ReminthHud.LOGGER.info("Tier test /tiers: {}", c.getString()), c -> ReminthHud.LOGGER.info("Tier test /tiers error: {}", c.getString()),
				System.getProperty("reminthhud.testTierName", "michaelcycle00"));
		}
	}
}
