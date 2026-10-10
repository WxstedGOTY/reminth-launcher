package com.wxsted.reminthhud.client.mixin;

import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/** Chat Timestamps (panel feature): the time in front of each new chat message, on your screen only. */
@Mixin(ChatComponent.class)
public abstract class ChatTimestampMixin {
	@ModifyVariable(method = "addMessage(Lnet/minecraft/network/chat/Component;Lnet/minecraft/network/chat/MessageSignature;Lnet/minecraft/client/multiplayer/chat/GuiMessageSource;Lnet/minecraft/client/multiplayer/chat/GuiMessageTag;)V", at = @At("HEAD"), argsOnly = true, ordinal = 0, require = 0)
	private Component reminthhud$stamp(Component msg) {
		try {
			return com.wxsted.reminthhud.client.panel.ChatHooks.onMessage(msg);
		} catch (Throwable ignored) {
			// leave the message as it is
		}
		return msg;
	}
}
