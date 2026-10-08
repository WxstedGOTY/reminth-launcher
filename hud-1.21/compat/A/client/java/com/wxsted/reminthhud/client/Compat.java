package com.wxsted.reminthhud.client;

import com.mojang.blaze3d.platform.InputConstants;

import org.lwjgl.glfw.GLFW;

import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.world.effect.MobEffectInstance;

/**
 * The few calls that differ between Minecraft versions. This is the version for
 * Minecraft 1.21 - 1.21.1 (1.21.4 - 1.21.5 is compat/F, same calls here): a PoseStack for drawing, and a text key category.
 * (compat/B, C, D and E hold the others; the build picks one with -Pcompat=...)
 */
final class Compat {
	private Compat() {
	}

	static KeyMapping registerToggleKey() {
		return KeyBindingHelper.registerKeyBinding(
				new KeyMapping("key.reminthhud.toggle", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_H, "key.categories.reminthhud")
		);
	}

	/** Moves the drawing origin to (x, y) and scales everything drawn after it, until pop(). */
	static void pushScaled(GuiGraphics graphics, float x, float y, float scale) {
		graphics.pose().pushPose();
		graphics.pose().translate(x, y, 0f);
		graphics.pose().scale(scale, scale, 1f);
	}

	static void pop(GuiGraphics graphics) {
		graphics.pose().popPose();
	}

	/** True while F3's own screen is up (it shows the same numbers in the same corner). */
	static boolean debugScreenShown(Minecraft client) {
		return client.getDebugOverlay().showDebugScreen();
	}

	/** Is this potion effect a good one (the game draws good and bad ones in two rows)? */
	static boolean isBeneficial(MobEffectInstance effect) {
		return effect.getEffect().value().isBeneficial();
	}

	/** The Controls category for the Reminth panel's keys too (a translation key on this version). */
	static Object category() {
		return "key.categories.reminthhud";
	}
}
