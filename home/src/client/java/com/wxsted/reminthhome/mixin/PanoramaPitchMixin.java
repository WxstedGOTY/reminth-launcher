package com.wxsted.reminthhome.mixin;

import com.wxsted.reminthhome.ReminthHomeClient;
import net.minecraft.client.gui.render.GuiRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

/**
 * The game draws the title panorama looking 10 degrees downwards, which cuts the sky off. Ours looks a
 * little upwards so the sky and the horizon fit. If this does not apply, the vanilla angle is used.
 */
@Mixin(GuiRenderer.class)
public abstract class PanoramaPitchMixin {
	@ModifyArg(method = "render", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/renderer/CubeMap;render(FF)V"), index = 0, require = 0)
	private float reminthhome$pitch(float pitch) {
		return ReminthHomeClient.panoramaPitch(pitch);
	}
}
