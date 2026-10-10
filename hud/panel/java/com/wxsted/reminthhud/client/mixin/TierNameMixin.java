package com.wxsted.reminthhud.client.mixin;

import com.wxsted.reminthhud.client.panel.TierTagger;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Tier Tagger (panel feature): the player's PvP tier in front of the name above their head. Only players as this game
 * sees them (AbstractClientPlayer) - in singleplayer the built-in server's players are left alone, so nothing reaches
 * chat or other players. Player.getDisplayName is the same in every version from 1.20.1 to 26.3.
 */
@Mixin(Player.class)
public abstract class TierNameMixin {
	@Inject(method = "getDisplayName", at = @At("RETURN"), cancellable = true, require = 0)
	private void reminthhud$tier(CallbackInfoReturnable<Component> cir) {
		try {
			Object self = this;
			if (!(self instanceof AbstractClientPlayer p)) return;
			TierTagger t = TierTagger.get();
			if (t == null || !t.enabled || !t.headsOn()) return;
			Component c = t.decorate(p.getUUID(), cir.getReturnValue());
			if (c != null) cir.setReturnValue(c);
		} catch (Throwable ignored) {
			// the plain name
		}
	}
}
