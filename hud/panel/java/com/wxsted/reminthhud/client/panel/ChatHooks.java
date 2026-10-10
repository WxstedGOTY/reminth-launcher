package com.wxsted.reminthhud.client.panel;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.sounds.SoundEvents;

/**
 * Every new chat line passes through here once (mixin/ChatTimestampMixin), on your screen only: the chat features
 * mark it, time it, or write it to your chat log. Nothing is ever sent, hidden or changed for anyone else.
 */
public final class ChatHooks {
	private ChatHooks() {
	}

	private static final ExecutorService LOG = Executors.newSingleThreadExecutor(r -> {
		Thread t = new Thread(r, "Reminth chat log");
		t.setDaemon(true);
		return t;
	});

	public static Component onMessage(Component msg) {
		Minecraft mc = Minecraft.getInstance();
		String plain = msg.getString();
		Component out = msg;
		if (Panel.byId("chatlog") instanceof ChatLog log && log.enabled) log.write(plain);
		if (Panel.byId("mention") instanceof Mention m && m.enabled) out = m.check(mc, plain, out);
		if (Panel.byId("highlight") instanceof Highlight h && h.enabled) out = h.check(mc, plain, out);
		if (Panel.byId("chatcount") instanceof Features5.StatLine c && c.enabled) c.count++;
		if (Panel.byId("chattime") instanceof Features3.ChatTimestamps t && t.enabled) out = t.stamp(out);
		return out;
	}

	static void ding(Minecraft mc, int sound, double volume) {
		var ev = switch (sound) {
			case 1 -> SoundEvents.NOTE_BLOCK_BELL;
			case 2 -> SoundEvents.NOTE_BLOCK_CHIME;
			case 3 -> SoundEvents.NOTE_BLOCK_XYLOPHONE;
			default -> SoundEvents.NOTE_BLOCK_PLING;
		};
		mc.getSoundManager().play(SimpleSoundInstance.forUI(ev.value(), 1.4f, (float) (volume / 100.0)));
	}

	static MutableComponent mark(Component msg, int color, String marker) {
		return Component.empty().append(Component.literal(marker + " ").withStyle(s -> s.withColor(color & 0xFFFFFF).withBold(true))).append(msg);
	}

	/** Your name in chat: a sound and a coloured mark in front of the line. */
	static final class Mention extends Module {
		private final Opt.Bool sound = opt(new Opt.Bool("sound", "Play a sound", true));
		private final Opt.Choice which = opt(new Opt.Choice("which", "Sound", 0, "Pling", "Bell", "Chime", "Xylophone"));
		private final Opt.Num volume = opt(new Opt.Num("volume", "Volume", 10, 100, 5, 70, "%"));
		private final Opt.Bool markIt = opt(new Opt.Bool("mark", "Mark the line", true));
		private final Opt.Color color = opt(new Opt.Color("color", "Mark colour", 0xFFFFAA00));
		private final Opt.Text also = opt(new Opt.Text("also", "Also these names (comma separated)", "", 80));
		private final Opt.Bool notOwn = opt(new Opt.Bool("notOwn", "Not my own messages", true));
		private long last;

		Mention() {
			super("mention", "Mention Alert", Cat.CHAT, "bell", "A sound and a mark when someone writes your name in chat.", true, false, null, 0, 0);
		}

		Component check(Minecraft mc, String plain, Component msg) {
			if (mc.player == null) return msg;
			String me = mc.player.getName().getString();
			String low = plain.toLowerCase(Locale.ROOT);
			if (notOwn.value && !me.isEmpty() && (low.startsWith("<" + me.toLowerCase(Locale.ROOT) + ">") || low.startsWith(me.toLowerCase(Locale.ROOT) + ":"))) return msg;
			boolean hit = !me.isEmpty() && Highlight.word(low, me.toLowerCase(Locale.ROOT));
			for (String n : also.value.split(",")) if (!n.isBlank() && Highlight.word(low, n.trim().toLowerCase(Locale.ROOT))) hit = true;
			if (!hit) return msg;
			long now = System.currentTimeMillis();
			if (sound.value && now - last > 600) {
				last = now;
				ding(mc, which.value, volume.value);
			}
			return markIt.value ? mark(msg, color.value, "»") : msg;
		}
	}

	/** Words you pick: marked (and a sound if you want) whenever they show up in chat. */
	static final class Highlight extends Module {
		private final Opt.Text words = opt(new Opt.Text("words", "Words (comma separated)", "gg, trade, help", 120));
		private final Opt.Color color = opt(new Opt.Color("color", "Mark colour", 0xFF55FFFF));
		private final Opt.Bool sound = opt(new Opt.Bool("sound", "Play a sound", false));
		private final Opt.Num volume = opt(new Opt.Num("volume", "Volume", 10, 100, 5, 50, "%"));

		Highlight() {
			super("highlight", "Chat Highlights", Cat.CHAT, "chat_color", "Marks chat lines with words you pick, like \"trade\" or your team's name.", true, false, null, 0, 0);
		}

		static boolean word(String text, String w) {
			if (w.isEmpty()) return false;
			int i = text.indexOf(w);
			while (i >= 0) {
				boolean a = i == 0 || !Character.isLetterOrDigit(text.charAt(i - 1));
				int e = i + w.length();
				boolean b = e >= text.length() || !Character.isLetterOrDigit(text.charAt(e));
				if (a && b) return true;
				i = text.indexOf(w, i + 1);
			}
			return false;
		}

		Component check(Minecraft mc, String plain, Component msg) {
			String low = plain.toLowerCase(Locale.ROOT);
			for (String w : words.value.split(",")) {
				if (word(low, w.trim().toLowerCase(Locale.ROOT))) {
					if (sound.value) ding(mc, 2, volume.value);
					return mark(msg, color.value, "◆");
				}
			}
			return msg;
		}
	}

	/** Writes chat to a text file per day: .minecraft/reminth-chatlogs/2026-10-10.txt. */
	static final class ChatLog extends Module {
		private final Opt.Bool times = opt(new Opt.Bool("times", "Time in front of each line", true));
		private final Opt.Bool server = opt(new Opt.Bool("server", "Server name in front of each line", false));

		ChatLog() {
			super("chatlog", "Chat Log", Cat.CHAT, "save", "Saves the chat to a text file for each day (in the reminth-chatlogs folder of your game folder).", true, false, null, 0, 0);
		}

		void write(String line) {
			Minecraft mc = Minecraft.getInstance();
			String srv = mc.getCurrentServer() == null ? "singleplayer" : mc.getCurrentServer().ip;
			String text = (times.value ? "[" + LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss", Locale.ROOT)) + "] " : "") + (server.value ? "(" + srv + ") " : "") + ChatFormatting.stripFormatting(line) + System.lineSeparator();
			Path f = FabricLoader.getInstance().getGameDir().resolve("reminth-chatlogs").resolve(LocalDate.now() + ".txt");
			LOG.execute(() -> {
				try {
					Files.createDirectories(f.getParent());
					Files.writeString(f, text, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
				} catch (IOException ignored) {
					// a log line is never worth an error
				}
			});
		}
	}
}
