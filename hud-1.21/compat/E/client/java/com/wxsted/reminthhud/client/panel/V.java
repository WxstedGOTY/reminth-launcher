package com.wxsted.reminthhud.client.panel;

import com.mojang.blaze3d.platform.InputConstants;
import java.util.function.Consumer;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;

/** The few calls that differ between Minecraft versions (compat family E: 1.20.1). */
public final class V {
	private V() {
	}

	public static Screen screen(Minecraft mc) {
		return mc.screen;
	}

	public static void setScreen(Minecraft mc, Screen s) {
		mc.setScreen(s);
	}

	/** A key in Controls (category: a translation key String on this version). */
	public static KeyMapping registerKey(String name, int key, Object category) {
		return KeyBindingHelper.registerKeyBinding(new KeyMapping(name, InputConstants.Type.KEYSYM, key, (String) category));
	}

	public static boolean matches(KeyMapping k, int key, int scancode, int mods) {
		return k.matches(key, scancode);
	}

	/** Draws `hud` with the game's HUD. */
	public static void registerHud(Consumer<Gfx> hud) {
		HudRenderCallback.EVENT.register((g, delta) -> hud.accept(new Gfx(g)));
	}

	/** F3's screen is open. */
	public static boolean debugShown(Minecraft mc) {
		return mc.options.renderDebug;
	}

	/** Draws `after` on top of `screen` every frame (for the tips on the title and loading screens). */
	public static void afterDraw(Screen screen, Consumer<Gfx> after) {
		ScreenEvents.afterRender(screen).register((s, g, mx, my, d) -> after.accept(new Gfx(g)));
	}

	/** The world's time of day in ticks (0 = morning). */
	public static long dayTime(Minecraft mc) {
		return mc.level.getDayTime();
	}

	/** A chat line only this player sees. */
	public static void say(Minecraft mc, net.minecraft.network.chat.Component c) {
		mc.player.displayClientMessage(c, false);
	}

	/** "overworld", "the_nether", "plains"...: the path of a dimension's or biome's id. */
	public static String keyPath(net.minecraft.resources.ResourceKey<?> key) {
		return key.location().getPath();
	}

	/** The game's millisecond clock (what its own ping measure uses). */
	public static long millis() {
		return net.minecraft.Util.getMillis();
	}

	/** The open screen shows the effect list itself (the inventory), so the game draws no effect icons. */
	public static boolean screenShowsEffects(Minecraft mc) {
		return mc.screen instanceof net.minecraft.client.gui.screens.inventory.EffectRenderingInventoryScreen<?> e && e.canSeeEffects();
	}

	/** Hunger and saturation the item gives when eaten, or null when it isn't food. */
	public static float[] food(net.minecraft.world.item.ItemStack stack) {
		net.minecraft.world.food.FoodProperties f = stack.getItem().getFoodProperties();
		return f == null ? null : new float[] {f.getNutrition(), f.getNutrition() * f.getSaturationModifier() * 2f};
	}

	/** Sends the game's own ping request (its answer is timed by mixin/PongMixin). */
	public static void sendPing(Minecraft mc, long time) {
		// 1.20.1 has no ping request packet (it came in 1.20.2): the player list number is used
	}

	/** The plain "message" screen (saving, joining...). */
	public static boolean isMessageScreen(net.minecraft.client.gui.screens.Screen s) {
		return false; // 1.20.1 has no GenericMessageScreen
	}

	/** A good effect (the game draws those on the top row). */
	public static boolean beneficial(net.minecraft.world.effect.MobEffectInstance e) {
		return e.getEffect().isBeneficial();
	}

	/** Lines added under every item tooltip. */
	public static void onTooltip(java.util.function.BiConsumer<net.minecraft.world.item.ItemStack, java.util.List<net.minecraft.network.chat.Component>> add) {
		net.fabricmc.fabric.api.client.item.v1.ItemTooltipCallback.EVENT.register((stack, flag, lines) -> add.accept(stack, lines));
	}

	/** The game's Controls screen (Key Binds). */
	public static net.minecraft.client.gui.screens.Screen controlsScreen(net.minecraft.client.gui.screens.Screen parent, net.minecraft.client.Options options) {
		return new net.minecraft.client.gui.screens.controls.KeyBindsScreen(parent, options);
	}

	/** The game is in full screen. */
	public static boolean isFullscreen(Minecraft mc) {
		return mc.getWindow().isFullscreen();
	}

	/** Shows or hides the Windows mouse pointer over the game (SoftCursor draws its own in full screen). */
	public static void osPointer(Minecraft mc, boolean visible) {
		org.lwjgl.glfw.GLFW.glfwSetInputMode(mc.getWindow().getWindow(), org.lwjgl.glfw.GLFW.GLFW_CURSOR, visible ? org.lwjgl.glfw.GLFW.GLFW_CURSOR_NORMAL : org.lwjgl.glfw.GLFW.GLFW_CURSOR_HIDDEN);
	}
}
