"""Writes the Reminth panel's mixins for each 1.20/1.21 compat family (hud-1.21/compat/<f>/client/java/.../mixin)."""
import os
ROOT=__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..')
FAM={
 'E':dict(v='1.20.1', fov='Double', fire='MC', pong=False, eff='OLD'),
 'A':dict(v='1.21 - 1.21.1', fov='Double', fire='MC', pong=True, eff='NEW'),
 'F':dict(v='1.21.4 - 1.21.5', fov='Float', fire='BUF', pong=True, eff='NEW'),
 'B':dict(v='1.21.6 - 1.21.8', fov='Float', fire='BUF', pong=True, eff='NEW'),
 'C':dict(v='1.21.9 - 1.21.10', fov='Float', fire='SPRITE', pong=True, eff='NEW'),
 'D':dict(v='1.21.11', fov='Float', fire='SPRITE', pong=True, eff='NEW'),
}
HEAD='package com.wxsted.reminthhud.client.mixin;\n\n'

def files(f,c):
    out={}
    cast='(double)' if c['fov']=='Double' else '(float)'
    out['CameraFovMixin']=HEAD+f'''import com.wxsted.reminthhud.client.panel.Panel;
import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Zoom (panel feature): narrows the field of view while the zoom key is held ({c['v']}: GameRenderer.getFov). */
@Mixin(GameRenderer.class)
public abstract class CameraFovMixin {{
	@Inject(method = "getFov", at = @At("RETURN"), cancellable = true, require = 0)
	private void reminthhud$zoom(Camera camera, float partialTick, boolean useFovSetting, CallbackInfoReturnable<{c['fov']}> cir) {{
		var zoom = Panel.zoomFeature();
		if (zoom != null && zoom.zooming(Minecraft.getInstance())) cir.setReturnValue({cast} (cir.getReturnValue() / zoom.factor()));
	}}
}}
'''
    out['MouseScrollMixin']=HEAD+'''import com.wxsted.reminthhud.client.panel.Panel;
import net.minecraft.client.Minecraft;
import net.minecraft.client.MouseHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Zoom (panel feature): scrolling while zoomed zooms further instead of changing the hotbar slot. */
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
'''
    if c['fire']=='MC':
        params='Minecraft mc, PoseStack pose, CallbackInfo ci'; imps='import net.minecraft.client.Minecraft;\n'
    elif c['fire']=='BUF':
        params='PoseStack pose, MultiBufferSource buffers, CallbackInfo ci'; imps='import net.minecraft.client.renderer.MultiBufferSource;\n'
    else:
        params='PoseStack pose, MultiBufferSource buffers, TextureAtlasSprite sprite, CallbackInfo ci'; imps='import net.minecraft.client.renderer.MultiBufferSource;\nimport net.minecraft.client.renderer.texture.TextureAtlasSprite;\n'
    out['FireOverlayMixin']=HEAD+f'''import com.mojang.blaze3d.vertex.PoseStack;
import com.wxsted.reminthhud.client.panel.Panel;
{imps}import net.minecraft.client.renderer.ScreenEffectRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Low Fire (panel feature): draws the fire on your screen lower ({c['v']}: ScreenEffectRenderer.renderFire). */
@Mixin(ScreenEffectRenderer.class)
public abstract class FireOverlayMixin {{
	@Inject(method = "renderFire", at = @At("HEAD"), require = 0)
	private static void reminthhud$lowerFire({params}) {{
		pose.pushPose();
		var low = Panel.lowFire();
		if (low != null && low.enabled) pose.translate(0f, (float) (-low.height.value / 100.0), 0f);
	}}

	@Inject(method = "renderFire", at = @At("RETURN"), require = 0)
	private static void reminthhud$lowerFireEnd({params}) {{
		pose.popPose();
	}}
}}
'''
    if c['pong']:
        out['PongMixin']=HEAD+'''import com.wxsted.reminthhud.client.panel.PingMeter;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.ping.ClientboundPongResponsePacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Ping (panel feature): times the answer to the ping request PingMeter sent. */
@Mixin(ClientPacketListener.class)
public abstract class PongMixin {
	@Inject(method = "handlePongResponse", at = @At("HEAD"), require = 0)
	private void reminthhud$pong(ClientboundPongResponsePacket packet, CallbackInfo ci) {
		// the game hands the packet over to its own thread first; count it once, there
		if (Minecraft.getInstance().isSameThread()) PingMeter.onPong(packet.time());
	}
}
'''
    else:
        out['PongMixin']=HEAD+'''import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;

/** 1.20.1 has no ping request (it came in 1.20.2): an empty stand-in so every family lists the same mixins. */
@Mixin(Minecraft.class)
public abstract class PongMixin {
}
'''
    out['AttackMixin']=HEAD+'''import com.wxsted.reminthhud.client.panel.Features3;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Hit Marker and Combo Counter (panel features): notices your own attacks. Changes nothing about them. */
@Mixin(MultiPlayerGameMode.class)
public abstract class AttackMixin {
	@Inject(method = "attack", at = @At("HEAD"), require = 0)
	private void reminthhud$attack(Player player, Entity target, CallbackInfo ci) {
		Features3.HitTracker.onAttack(Minecraft.getInstance(), target);
	}
}
'''
    out['ChatTimestampMixin']=HEAD+'''import com.wxsted.reminthhud.client.panel.Features3;
import com.wxsted.reminthhud.client.panel.Panel;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/** Chat Timestamps (panel feature): the time in front of each new chat message, on your screen only. */
@Mixin(ChatComponent.class)
public abstract class ChatTimestampMixin {
	// the 3-argument addMessage: every chat line goes through it once (addMessage(Component) calls it)
	@ModifyVariable(method = "addMessage(Lnet/minecraft/network/chat/Component;Lnet/minecraft/network/chat/MessageSignature;Lnet/minecraft/client/GuiMessageTag;)V", at = @At("HEAD"), argsOnly = true, ordinal = 0, require = 0)
	private Component reminthhud$stamp(Component msg) {
		try {
			if (Panel.byId("chattime") instanceof Features3.ChatTimestamps t && t.enabled) return t.stamp(msg);
		} catch (Throwable ignored) {
			// leave the message as it is
		}
		return msg;
	}
}
'''
    if c['eff']=='OLD':
        eparams='GuiGraphics g, CallbackInfo ci'; eimp=''
    else:
        eparams='GuiGraphics g, DeltaTracker delta, CallbackInfo ci'; eimp='import net.minecraft.client.DeltaTracker;\n'
    out['EffectIconMixin']=HEAD+f'''import com.wxsted.reminthhud.client.panel.Features;
import com.wxsted.reminthhud.client.panel.Gfx;
import com.wxsted.reminthhud.client.panel.Panel;
{eimp}import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiGraphics;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Potion Effects (panel feature): level and time left on the game's own effect icons ({c['v']}: Gui.renderEffects). */
@Mixin(Gui.class)
public abstract class EffectIconMixin {{
	@Inject(method = "renderEffects", at = @At("TAIL"), require = 0)
	private void reminthhud$effectText({eparams}) {{
		try {{
			if (Panel.byId("effects") instanceof Features.PotionEffects p) p.drawOnIcons(new Gfx(g), Minecraft.getInstance());
		}} catch (Throwable ignored) {{
			// the icons stay as the game drew them
		}}
	}}
}}
'''
    return out

for f,c in FAM.items():
    d=f'{ROOT}/compat/{f}/client/java/com/wxsted/reminthhud/client/mixin'
    os.makedirs(d,exist_ok=True)
    for name,src in files(f,c).items():
        open(f'{d}/{name}.java','w',encoding='utf-8',newline='\n').write(src)
names=list(files('D',FAM['D']).keys())
open(f'{ROOT}/src/main/resources/reminthhud.mixins.json','w',encoding='utf-8',newline='\n').write('''{
	"required": true,
	"package": "com.wxsted.reminthhud.client.mixin",
	"compatibilityLevel": "JAVA_17",
	"client": [
%s
	],
	"injectors": {
		"defaultRequire": 0
	}
}
''' % ',\n'.join('\t\t"%s"' % n for n in names))
print('mixins written:', names)
