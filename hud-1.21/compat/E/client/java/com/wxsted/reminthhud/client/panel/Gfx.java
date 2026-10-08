package com.wxsted.reminthhud.client.panel;

import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;

/**
 * The panel's drawing calls, for this Minecraft version (compat family E: 1.20.1 - GuiGraphics).
 * The panel code only draws through this class, so the same panel code builds for every version.
 */
public final class Gfx {
	private final GuiGraphics g;

	public Gfx(GuiGraphics g) {
		this.g = g;
	}

	public GuiGraphics raw() {
		return g;
	}

	public int guiWidth() {
		return g.guiWidth();
	}

	public int guiHeight() {
		return g.guiHeight();
	}

	public void fill(int x1, int y1, int x2, int y2, int color) {
		g.fill(x1, y1, x2, y2, color);
	}

	/** A 1 px frame (four lines: the game's own outline call has a different name on some versions). */
	public void outline(int x, int y, int w, int h, int color) {
		g.fill(x, y, x + w, y + 1, color);
		g.fill(x, y + h - 1, x + w, y + h, color);
		g.fill(x, y + 1, x + 1, y + h - 1, color);
		g.fill(x + w - 1, y + 1, x + w, y + h - 1, color);
	}

	public void text(Font f, String s, int x, int y, int color, boolean shadow) {
		g.drawString(f, s, x, y, color, shadow);
	}

	public void text(Font f, Component s, int x, int y, int color, boolean shadow) {
		g.drawString(f, s, x, y, color, shadow);
	}

	public void textWithWordWrap(Font f, Component s, int x, int y, int width, int color, boolean shadow) {
		g.drawWordWrap(f, s, x, y, width, color); // no shadow argument on this version
	}

	public void push() {
		g.pose().pushPose();
	}

	public void pop() {
		g.pose().popPose();
	}

	public void translate(float x, float y) {
		g.pose().translate(x, y, 0f);
	}

	public void scale(float x, float y) {
		g.pose().scale(x, y, 1f);
	}

	public void item(ItemStack stack, int x, int y) {
		g.renderItem(stack, x, y);
	}

	public void itemDecorations(Font f, ItemStack stack, int x, int y) {
		g.renderItemDecorations(f, stack, x, y);
	}

	public void enableScissor(int x1, int y1, int x2, int y2) {
		// this version clips in screen units without the current scaling: apply it here
		org.joml.Matrix4f m = g.pose().last().pose();
		org.joml.Vector3f a = m.transformPosition(new org.joml.Vector3f(x1, y1, 0)), b = m.transformPosition(new org.joml.Vector3f(x2, y2, 0));
		g.enableScissor((int) Math.floor(Math.min(a.x, b.x)), (int) Math.floor(Math.min(a.y, b.y)), (int) Math.ceil(Math.max(a.x, b.x)), (int) Math.ceil(Math.max(a.y, b.y)));
	}

	public void disableScissor() {
		g.disableScissor();
	}

	/** One of the panel's 128x128 icons (assets/reminthhud/textures/gui/panel/<name>.png) at size s, tinted (ARGB). */
	public void icon(String name, int x, int y, int s, int color) {
		ResourceLocation id = new ResourceLocation("reminthhud", "textures/gui/panel/" + name + ".png");
		// no tint argument on this version: the colour is set around the draw
		RenderSystem.enableBlend();
		g.setColor(((color >> 16) & 0xFF) / 255f, ((color >> 8) & 0xFF) / 255f, (color & 0xFF) / 255f, ((color >>> 24) & 0xFF) / 255f);
		g.blit(id, x, y, s, s, 0f, 0f, 128, 128, 128, 128);
		g.setColor(1f, 1f, 1f, 1f);
		RenderSystem.disableBlend();
	}

	private Font tipFont;
	private Component tip;
	private int tipX, tipY;

	/** A tooltip drawn after everything else this frame (flushTooltip). */
	public void setTooltipForNextFrame(Font f, Component c, int x, int y) {
		tipFont = f;
		tip = c;
		tipX = x;
		tipY = y;
	}

	public void flushTooltip() {
		if (tip != null) g.renderTooltip(tipFont, tip, tipX, tipY);
		tip = null;
	}
}
