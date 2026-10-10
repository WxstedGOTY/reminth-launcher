package com.wxsted.reminthhud.client.panel;

import com.mojang.blaze3d.platform.InputConstants;
import com.wxsted.reminthhud.ReminthHud;
import java.util.function.Consumer;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.gui.screens.Screen;

/** The few calls that differ between Minecraft versions (compat family B: 26.3). */
public final class V {
	private V() {
	}

	public static Screen screen(Minecraft mc) {
		return mc.gui.screen();
	}

	public static void setScreen(Minecraft mc, Screen s) {
		mc.gui.setScreen(s);
	}


	/** A key in Controls (category: KeyMapping.Category on 26.x). */
	public static KeyMapping registerKey(String name, int key, Object category) {
		return KeyMappingHelper.registerKeyMapping(new KeyMapping(name, keyboard(), key, (KeyMapping.Category) category));
	}

	/** 26.3 merged KEYSYM into KEYBOARD: found by name so one jar works on both. */
	private static InputConstants.Type keyboard() {
		for (String n : new String[] {"KEYBOARD", "KEYSYM"}) {
			try {
				return Enum.valueOf(InputConstants.Type.class, n);
			} catch (IllegalArgumentException ignored) {
				// try the other name
			}
		}
		throw new IllegalStateException("No keyboard input type");
	}

	/** Draws `after` on top of `screen` every frame (for the tips on the title and loading screens). */
	public static void afterDraw(net.minecraft.client.gui.screens.Screen screen, Consumer<Gfx> after) {
		ScreenEvents.afterExtract(screen).register((s, g, mx, my, d) -> after.accept(new Gfx(g)));
	}

	public static boolean matches(KeyMapping k, int key, int scancode, int mods) {
		return k.matches(new KeyEvent(key, scancode, mods));
	}

	/** Draws `hud` with the game's HUD, under the chat. */
	public static void registerHud(Consumer<Gfx> hud) {
		HudElementRegistry.attachElementBefore(VanillaHudElements.CHAT, ReminthHud.id("panel_hud"), (g, delta) -> hud.accept(new Gfx(g)));
	}

	/** F3's screen is open. */
	public static boolean debugShown(Minecraft mc) {
		return mc.debugEntries.isOverlayVisible();
	}

	/** The world's time of day in ticks (0 = morning). */
	public static long dayTime(Minecraft mc) {
		return mc.level.getOverworldClockTime();
	}

	/** A chat line only this player sees. */
	public static void say(Minecraft mc, net.minecraft.network.chat.Component c) {
		mc.player.sendSystemMessage(c);
	}

	/** "overworld", "the_nether", "plains"...: the path of a dimension's or biome's id. */
	public static String keyPath(net.minecraft.resources.ResourceKey<?> key) {
		return key.identifier().getPath();
	}

	/** The game's millisecond clock (what its own ping measure uses). */
	public static long millis() {
		return net.minecraft.util.Util.getMillis();
	}

	/** The open screen shows the effect list itself (the inventory), so the game draws no effect icons. */
	public static boolean screenShowsEffects(Minecraft mc) {
		return screen(mc) != null && screen(mc).showsActiveEffects();
	}

	/** Hunger and saturation the item gives when eaten, or null when it isn't food. */
	public static float[] food(net.minecraft.world.item.ItemStack stack) {
		net.minecraft.world.food.FoodProperties f = stack.get(net.minecraft.core.component.DataComponents.FOOD);
		return f == null ? null : new float[] {f.nutrition(), f.saturation()};
	}

	/** Sends the game's own ping request (its answer is timed by mixin/PongMixin). */
	public static void sendPing(Minecraft mc, long time) {
		mc.getConnection().send(new net.minecraft.network.protocol.ping.ServerboundPingRequestPacket(time));
	}

	/** The plain "message" screen (saving, joining...). */
	public static boolean isMessageScreen(net.minecraft.client.gui.screens.Screen s) {
		return s instanceof net.minecraft.client.gui.screens.GenericMessageScreen;
	}

	/** A good effect (the game draws those on the top row). */
	public static boolean beneficial(net.minecraft.world.effect.MobEffectInstance e) {
		return e.getEffect().value().isBeneficial();
	}

	/** Lines added under every item tooltip. */
	public static void onTooltip(java.util.function.BiConsumer<net.minecraft.world.item.ItemStack, java.util.List<net.minecraft.network.chat.Component>> add) {
		net.fabricmc.fabric.api.client.item.v1.ItemTooltipCallback.EVENT.register((stack, context, flag, lines) -> add.accept(stack, lines));
	}

	/** The game's Controls screen (Key Binds). */
	public static net.minecraft.client.gui.screens.Screen controlsScreen(net.minecraft.client.gui.screens.Screen parent, net.minecraft.client.Options options) {
		return new net.minecraft.client.gui.screens.options.controls.KeyBindsScreen(parent, options);
	}

	/** The game is in full screen. */
	public static boolean isFullscreen(Minecraft mc) {
		return mc.options.fullscreen().get(); // 26.3 (SDL3): the window has no public full-screen getter
	}

	/** Shows or hides the Windows mouse pointer over the game (SoftCursor draws its own in full screen). */
	public static void osPointer(Minecraft mc, boolean visible) {
		if (visible) org.lwjgl.sdl.SDLMouse.SDL_ShowCursor();
		else org.lwjgl.sdl.SDLMouse.SDL_HideCursor();
	}

	/** Shows or hides a part of your skin (cape, jacket, sleeves...). */
	public static void setModelPart(net.minecraft.client.Options o, net.minecraft.world.entity.player.PlayerModelPart part, boolean on) {
		o.setModelPart(part, on);
	}

	/** Hides the game's own crosshair while hide says so (Custom Crosshair). True: this version can. */
	public static boolean hideCrosshair(java.util.function.BooleanSupplier hide) {
		HudElementRegistry.replaceElement(VanillaHudElements.CROSSHAIR, old -> (g, d) -> {
			if (!hide.getAsBoolean()) old.extractRenderState(g, d);
		});
		return true;
	}
}
