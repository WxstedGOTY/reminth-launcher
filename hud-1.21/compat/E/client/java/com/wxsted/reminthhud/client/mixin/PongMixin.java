package com.wxsted.reminthhud.client.mixin;

import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;

/** 1.20.1 has no ping request (it came in 1.20.2): an empty stand-in so every family lists the same mixins. */
@Mixin(Minecraft.class)
public abstract class PongMixin {
}
