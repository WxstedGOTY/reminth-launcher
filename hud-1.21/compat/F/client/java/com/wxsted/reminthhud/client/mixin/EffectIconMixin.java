package com.wxsted.reminthhud.client.mixin;

import com.wxsted.reminthhud.client.panel.Features;
import com.wxsted.reminthhud.client.panel.Gfx;
import com.wxsted.reminthhud.client.panel.Panel;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiGraphics;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Potion Effects (panel feature): level and time left on the game's own effect icons (1.21.4 - 1.21.5: Gui.renderEffects). */
@Mixin(Gui.class)
public abstract class EffectIconMixin {
	@Inject(method = "renderEffects", at = @At("TAIL"), require = 0)
	private void reminthhud$effectText(GuiGraphics g, DeltaTracker delta, CallbackInfo ci) {
		try {
			if (Panel.byId("effects") instanceof Features.PotionEffects p) p.drawOnIcons(new Gfx(g), Minecraft.getInstance());
		} catch (Throwable ignored) {
			// the icons stay as the game drew them
		}
	}
}
