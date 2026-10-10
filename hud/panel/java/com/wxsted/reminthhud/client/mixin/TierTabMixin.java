package com.wxsted.reminthhud.client.mixin;

import com.wxsted.reminthhud.client.panel.TierTagger;
import net.minecraft.client.gui.components.PlayerTabOverlay;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Tier Tagger (panel feature): the PvP tier in front of each name in the tab list (same method in every version). */
@Mixin(PlayerTabOverlay.class)
public abstract class TierTabMixin {
	@Inject(method = "getNameForDisplay", at = @At("RETURN"), cancellable = true, require = 0)
	private void reminthhud$tier(PlayerInfo info, CallbackInfoReturnable<Component> cir) {
		try {
			TierTagger t = TierTagger.get();
			if (t == null || !t.enabled) return;
			Component c = t.decorateTab(info, cir.getReturnValue());
			if (c != null) cir.setReturnValue(c);
		} catch (Throwable ignored) {
			// the plain name
		}
	}
}
