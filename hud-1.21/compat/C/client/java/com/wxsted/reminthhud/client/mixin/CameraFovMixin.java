package com.wxsted.reminthhud.client.mixin;

import com.wxsted.reminthhud.client.panel.Panel;
import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Zoom (panel feature): narrows the field of view while the zoom key is held (1.21.9 - 1.21.10: GameRenderer.getFov). */
@Mixin(GameRenderer.class)
public abstract class CameraFovMixin {
	@Inject(method = "getFov", at = @At("RETURN"), cancellable = true, require = 0)
	private void reminthhud$zoom(Camera camera, float partialTick, boolean useFovSetting, CallbackInfoReturnable<Float> cir) {
		var zoom = Panel.zoomFeature();
		if (zoom != null && zoom.zooming(Minecraft.getInstance())) cir.setReturnValue((float) (cir.getReturnValue() / zoom.factor()));
	}
}
