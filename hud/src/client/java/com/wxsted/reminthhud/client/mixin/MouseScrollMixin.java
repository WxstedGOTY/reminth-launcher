package com.wxsted.reminthhud.client.mixin;

import com.wxsted.reminthhud.client.panel.Panel;
import net.minecraft.client.Minecraft;
import net.minecraft.client.MouseHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Zoom (panel feature): while zooming, the scroll wheel zooms further instead of changing the hotbar slot. */
@Mixin(MouseHandler.class)
public abstract class MouseScrollMixin {
	@Inject(method = "onScroll", at = @At("HEAD"), cancellable = true, require = 0)
	private void reminthhud$zoomScroll(long window, double x, double y, CallbackInfo ci) {
		var zoom = Panel.zoomFeature();
		if (zoom == null || !zoom.scroll.value || !zoom.zooming(Minecraft.getInstance()) || y == 0) return;
		zoom.extra = Math.max(0.5, Math.min(4, zoom.extra * (y > 0 ? 1.15 : 1 / 1.15)));
		ci.cancel();
	}
}
