package com.wxsted.reminthhud.client.mixin;

import com.wxsted.reminthhud.client.panel.Features;
import com.wxsted.reminthhud.client.panel.Panel;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Potion Effects (panel feature): level and time left on the game's own effect icons (Hud on 26.2+, Gui on 26.1). */
@Mixin(targets = {"net.minecraft.client.gui.Hud", "net.minecraft.client.gui.Gui"})
public abstract class EffectIconMixin {
	@Inject(method = "extractEffects", at = @At("TAIL"), require = 0)
	private void reminthhud$effectText(GuiGraphicsExtractor g, DeltaTracker delta, CallbackInfo ci) {
		try {
			if (Panel.byId("effects") instanceof Features.PotionEffects p) p.drawOnIcons(g, Minecraft.getInstance());
		} catch (Throwable ignored) {
			// the icons stay as the game drew them
		}
	}
}
