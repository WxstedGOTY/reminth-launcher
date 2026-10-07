package com.wxsted.reminthhome.mixin;

import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;

/** Minecraft before 1.21.9 never switches cursors itself: nothing to hook (the pixel arrow is set by CursorFix). */
@Mixin(Minecraft.class)
public abstract class CursorTypeMixin {
}
