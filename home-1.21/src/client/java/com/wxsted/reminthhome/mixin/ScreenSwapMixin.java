package com.wxsted.reminthhome.mixin;

import com.wxsted.reminthhome.ReminthHomeClient;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/** Every way to the title screen goes through Minecraft.setScreen; the vanilla one is swapped for ours. */
@Mixin(Minecraft.class)
public abstract class ScreenSwapMixin {
	@ModifyVariable(method = "setScreen", at = @At("HEAD"), argsOnly = true, require = 0)
	private Screen reminthhome$swapTitle(Screen screen) {
		return ReminthHomeClient.swap(screen);
	}
}
