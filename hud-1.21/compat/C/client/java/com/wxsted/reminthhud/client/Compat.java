package com.wxsted.reminthhud.client;

import com.mojang.blaze3d.platform.InputConstants;

import org.lwjgl.glfw.GLFW;

import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.resources.ResourceLocation;

/**
 * The few calls that differ between Minecraft versions. Minecraft 1.21.9 - 1.21.10: a 2D matrix stack, and a key category object (ResourceLocation).
 * (the build picks the family with -Pcompat=...)
 */
final class Compat {
	private Compat() {
	}

	// 1.21.9 made the key category an object, registered once.
	private static final KeyMapping.Category CATEGORY = KeyMapping.Category.register(
			ResourceLocation.fromNamespaceAndPath("reminthhud", "reminthhud_category")
	);

	static KeyMapping registerToggleKey() {
		return KeyBindingHelper.registerKeyBinding(
				new KeyMapping("key.reminthhud.toggle", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_H, CATEGORY)
		);
	}

	/** Moves the drawing origin to (x, y) and scales everything drawn after it, until pop(). */
	static void pushScaled(GuiGraphics graphics, float x, float y, float scale) {
		graphics.pose().pushMatrix();
		graphics.pose().translate(x, y);
		graphics.pose().scale(scale, scale);
	}

	static void pop(GuiGraphics graphics) {
		graphics.pose().popMatrix();
	}

	/** True while F3's own screen is up (it shows the same numbers in the same corner). */
	static boolean debugScreenShown(Minecraft client) {
		return client.getDebugOverlay().showDebugScreen();
	}

	/** Is this potion effect a good one (the game draws good and bad ones in two rows)? */
	static boolean isBeneficial(MobEffectInstance effect) {
		return effect.getEffect().value().isBeneficial();
	}

	/** The Controls category for the Reminth panel's keys too. */
	static Object category() {
		return CATEGORY;
	}
}
