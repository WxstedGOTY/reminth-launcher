package com.wxsted.reminthtest;

import java.util.ArrayList;
import java.util.List;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.gui.screens.options.LanguageSelectScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.worldselection.CreateWorldScreen;
import net.minecraft.client.gui.screens.worldselection.SelectWorldScreen;

/**
 * THROWAWAY. On the title screen it runs a list of ways to leave and come back, and prints PASS/FAIL for each:
 * what comes back must be the Reminth title screen with its buttons (and exactly one set of them).
 */
public class TestClient implements ClientModInitializer {
	interface Act { void run(Minecraft mc, Screen title) throws Exception; }
	record Case(String name, Act act) {}

	final List<Case> cases = new ArrayList<>();
	int tick = 0, idx = 0, wait = 0, phase = 0;
	Screen title;
	int baseWidgets = -1, retries = 0;

	@Override
	public void onInitializeClient() {
		cases.add(new Case("Singleplayer (worlds) -> Back", (mc, t) -> { mc.gui.setScreen(new SelectWorldScreen(t)); }));
		cases.add(new Case("Options -> Done", (mc, t) -> mc.gui.setScreen(new OptionsScreen(t, mc.options, false))));
		cases.add(new Case("Language -> Done", (mc, t) -> mc.gui.setScreen(new LanguageSelectScreen(t, mc.options, mc.getLanguageManager()))));
		cases.add(new Case("Multiplayer -> Back", (mc, t) -> mc.gui.setScreen(new JoinMultiplayerScreen(t))));
		cases.add(new Case("Create World -> Cancel (the owner's bug)", (mc, t) -> CreateWorldScreen.openFresh(mc, () -> mc.gui.setScreen(null))));
		cases.add(new Case("Create World -> Cancel (via a new TitleScreen)", (mc, t) -> CreateWorldScreen.openFresh(mc, () -> mc.gui.setScreen(new TitleScreen()))));
		cases.add(new Case("setScreen(null) with no world open", (mc, t) -> mc.gui.setScreen(new OptionsScreen(t, mc.options, false))));
		cases.add(new Case("window resized 5 times", (mc, t) -> { for (int i = 0; i < 5; i++) t.resize(800 + i * 20, 450 + i * 10); }));
		ClientTickEvents.END_CLIENT_TICK.register(this::tick);
	}

	static String describe(Minecraft mc) {
		Screen s = mc.gui.screen();
		if (s == null) return "null";
		int round = 0, all = 0;
		for (var c : s.children()) {
			all++;
			if (c.getClass().getSimpleName().equals("RoundButton")) round++;
		}
		return s.getClass().getSimpleName() + " widgets=" + all + " round=" + round;
	}

	boolean isOurs(Minecraft mc) {
		Screen s = mc.gui.screen();
		if (s == null || !s.getClass().getName().equals("com.wxsted.reminthhome.ReminthTitleScreen")) return false;
		int round = 0;
		for (var c : s.children()) if (c.getClass().getSimpleName().equals("RoundButton")) round++;
		return round >= 5;
	}

	void tick(Minecraft mc) {
		if (idx >= cases.size() + 1) return;
		if (!(mc.gui.screen() instanceof TitleScreen) && title == null) return;
		if (++tick < 200) return;
		if (wait > 0) { wait--; return; }
		try {
			if (title == null) {
				title = mc.gui.screen();
				baseWidgets = title.children().size();
				System.out.println("[hometest] start: " + describe(mc));
				return;
			}
			if (idx == cases.size()) {
				System.out.println("[hometest] DONE");
				idx++;
				mc.stop();
				return;
			}
			Case c = cases.get(idx);
			if (phase == 0) {
				System.out.println("[hometest] ... " + c.name());
				c.act().run(mc, title);
				phase = 1;
				wait = 40;
			} else {
				if (c.name().startsWith("Create World") && mc.gui.screen() instanceof TitleScreen && retries++ < 8) { wait = 30; return; } // the screen opens after its data loaded
				retries = 0;
				boolean resizeCase = c.name().startsWith("window resized");
				boolean noBack = c.name().startsWith("setScreen(null)");
				if (noBack) {
					// from an Options screen: setScreen(null) while no world is open
					mc.gui.setScreen(null);
				} else if (!resizeCase && mc.gui.screen() != null && !(mc.gui.screen() instanceof TitleScreen)) {
					mc.gui.screen().onClose(); // what Back / Done / Cancel runs
				}
				wait = 40;
				phase = 2;
				return;
			}
		} catch (Throwable t) {
			System.out.println("[hometest] ERROR " + t);
			t.printStackTrace();
			idx = 99;
			return;
		}
		if (phase == 2) {
			// unreachable (kept simple): result is judged on the next tick
		}
	}

	{
		ClientTickEvents.END_CLIENT_TICK.register(mc -> {
			if (idx >= cases.size() || title == null || phase != 2 || wait > 0) return;
			boolean ok = isOurs(mc);
			Screen s = mc.gui.screen();
			int widgets = s == null ? -1 : s.children().size();
			boolean sameCount = widgets == baseWidgets;
			System.out.println("[hometest] " + (ok && sameCount ? "PASS" : "FAIL") + " - " + cases.get(idx).name() + " -> " + describe(mc) + (sameCount ? "" : " (widgets changed from " + baseWidgets + ")"));
			idx++;
			phase = 0;
			wait = 20;
		});
	}
}
