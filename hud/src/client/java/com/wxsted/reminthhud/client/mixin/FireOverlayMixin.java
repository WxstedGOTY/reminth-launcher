package com.wxsted.reminthhud.client.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import com.wxsted.reminthhud.client.panel.Panel;
import net.minecraft.client.renderer.ScreenEffectRenderer;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.texture.TextureAtlasSprite;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Low fire (panel feature): the burning overlay is drawn lower on the screen. */
@Mixin(ScreenEffectRenderer.class)
public abstract class FireOverlayMixin {
	@Inject(method = "submitFire", at = @At("HEAD"), require = 0)
	private static void reminthhud$lowerFire(PoseStack pose, SubmitNodeCollector collector, TextureAtlasSprite sprite, CallbackInfo ci) {
		pose.pushPose();
		var low = Panel.lowFire();
		if (low != null && low.enabled) pose.translate(0f, (float) (-low.height.value / 100.0), 0f);
	}

	@Inject(method = "submitFire", at = @At("RETURN"), require = 0)
	private static void reminthhud$lowerFireEnd(PoseStack pose, SubmitNodeCollector collector, TextureAtlasSprite sprite, CallbackInfo ci) {
		pose.popPose();
	}
}
