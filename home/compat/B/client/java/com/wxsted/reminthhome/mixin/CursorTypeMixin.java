package com.wxsted.reminthhome.mixin;

import com.mojang.blaze3d.platform.Window;
import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import com.wxsted.reminthhome.PixelCursor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The game's own cursor switch (arrow, hand over buttons, text beam): Reminth's pixel versions instead. */
@Mixin(CursorType.class)
public abstract class CursorTypeMixin {
	@Inject(method = "select", at = @At("HEAD"), cancellable = true, require = 0)
	private void reminthhome$pixelCursor(CallbackInfo ci) {
		Object self = this;
		Window window = net.minecraft.client.Minecraft.getInstance().getWindow();
		int h = window == null ? 1080 : window.getScreenHeight();
		long c = 0L;
		if (self == CursorType.DEFAULT || self == CursorTypes.ARROW) c = PixelCursor.arrow(h);
		else if (self == CursorTypes.POINTING_HAND) c = PixelCursor.hand(h);
		else if (self == CursorTypes.IBEAM) c = PixelCursor.beam(h);
		if (c != 0L) {
			PixelCursor.set(0L, c); // SDL: one cursor for the app
			ci.cancel();
		}
	}
}
