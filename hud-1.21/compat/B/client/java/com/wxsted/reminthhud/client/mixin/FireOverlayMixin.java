package com.wxsted.reminthhud.client.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import com.wxsted.reminthhud.client.panel.Panel;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.ScreenEffectRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Low Fire (panel feature): draws the fire on your screen lower (1.21.6 - 1.21.8: ScreenEffectRenderer.renderFire). */
@Mixin(ScreenEffectRenderer.class)
public abstract class FireOverlayMixin {
	@Inject(method = "renderFire", at = @At("HEAD"), require = 0)
	private static void reminthhud$lowerFire(PoseStack pose, MultiBufferSource buffers, CallbackInfo ci) {
		pose.pushPose();
		var low = Panel.lowFire();
		if (low != null && low.enabled) pose.translate(0f, (float) (-low.height.value / 100.0), 0f);
	}

	@Inject(method = "renderFire", at = @At("RETURN"), require = 0)
	private static void reminthhud$lowerFireEnd(PoseStack pose, MultiBufferSource buffers, CallbackInfo ci) {
		pose.popPose();
	}
}
