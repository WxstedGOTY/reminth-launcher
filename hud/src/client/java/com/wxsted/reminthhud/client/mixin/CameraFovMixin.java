package com.wxsted.reminthhud.client.mixin;

import com.wxsted.reminthhud.client.panel.Panel;
import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Zoom (panel feature): the field of view is divided by the zoom while the zoom key is held. */
@Mixin(Camera.class)
public abstract class CameraFovMixin {
	@Inject(method = "calculateFov", at = @At("RETURN"), cancellable = true, require = 0)
	private void reminthhud$zoom(float partialTick, CallbackInfoReturnable<Float> cir) {
		var zoom = Panel.zoomFeature();
		if (zoom != null && zoom.zooming(Minecraft.getInstance())) cir.setReturnValue((float) (cir.getReturnValue() / zoom.factor()));
	}
}
