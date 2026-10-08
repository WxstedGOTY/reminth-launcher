package com.wxsted.reminthhud.client.mixin;

import com.wxsted.reminthhud.client.panel.Features3;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Hit Marker and Combo Counter (panel features): notices your own attacks. Changes nothing about them. */
@Mixin(MultiPlayerGameMode.class)
public abstract class AttackMixin {
	@Inject(method = "attack", at = @At("HEAD"), require = 0)
	private void reminthhud$attack(Player player, Entity target, CallbackInfo ci) {
		Features3.HitTracker.onAttack(Minecraft.getInstance(), target);
	}
}
