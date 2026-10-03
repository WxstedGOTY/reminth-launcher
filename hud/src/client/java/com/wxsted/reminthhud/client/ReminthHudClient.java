package com.wxsted.reminthhud.client;

import com.mojang.blaze3d.platform.InputConstants;
import com.wxsted.reminthhud.ReminthHud;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;

import net.minecraft.client.DeltaTracker;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.player.LocalPlayer;

public class ReminthHudClient implements ClientModInitializer {

	// Whether the overlay is currently shown. Starts on.
	private static boolean hudVisible = true;

	// Groups our keybind under its own heading in Options > Controls > Key Binds.
	private static final KeyMapping.Category CATEGORY = KeyMapping.Category.register(
			ReminthHud.id("reminthhud_category")
	);

	// Default key: H. Players can rebind this in the controls menu regardless.
	// (26.3 merged the old KEYSYM/SCANCODE input types into KEYBOARD.)
	private static final KeyMapping TOGGLE_KEY = KeyMappingHelper.registerKeyMapping(
			new KeyMapping(
					"key.reminthhud.toggle",
					InputConstants.Type.KEYBOARD,
					InputConstants.KEY_H,
					CATEGORY
			)
	);

	@Override
	public void onInitializeClient() {
		// Flip hudVisible once per key press, checked every client tick.
		ClientTickEvents.END_CLIENT_TICK.register(client -> {
			while (TOGGLE_KEY.consumeClick()) {
				hudVisible = !hudVisible;
			}
		});

		// Draw our overlay right before the chat HUD layer renders.
		HudElementRegistry.attachElementBefore(
				VanillaHudElements.CHAT,
				ReminthHud.id("overlay"),
				ReminthHudClient::render
		);
	}

	private static void render(GuiGraphicsExtractor graphics, DeltaTracker tickCounter) {
		if (!hudVisible) {
			return;
		}

		Minecraft client = Minecraft.getInstance();
		LocalPlayer player = client.player;
		if (player == null) {
			return;
		}

		String[] lines = {
				"FPS: " + client.getFps(),
				String.format("XYZ: %.1f / %.1f / %.1f", player.getX(), player.getY(), player.getZ()),
				"Facing: " + facing(player.getYRot())
		};

		int x = 4;
		int y = 4;
		int lineHeight = 10;
		int paddingX = 4;
		int width = 150;
		int height = lines.length * lineHeight + paddingX * 2;

		// Semi-transparent black backdrop so the text stays readable over any background.
		graphics.fill(x, y, x + width, y + height, 0x90000000);

		for (int i = 0; i < lines.length; i++) {
			graphics.text(
					client.font,
					lines[i],
					x + paddingX,
					y + paddingX + i * lineHeight,
					0xFFFFFFFF,
					true
			);
		}
	}

	// Minecraft yaw: 0 = south, increases clockwise (90 = west, 180 = north, 270 = east).
	private static String facing(float yaw) {
		String[] directions = {"S", "SW", "W", "NW", "N", "NE", "E", "SE"};
		float normalized = yaw % 360f;
		if (normalized < 0) {
			normalized += 360f;
		}
		int index = Math.round(normalized / 45f) & 7;
		return directions[index];
	}
}