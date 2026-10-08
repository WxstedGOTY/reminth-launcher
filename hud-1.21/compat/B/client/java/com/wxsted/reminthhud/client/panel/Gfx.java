package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;

/**
 * The panel's drawing calls, for this Minecraft version (compat family B: 1.21.6 - 1.21.8 - GuiGraphics).
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
		g.drawWordWrap(f, s, x, y, width, color, shadow);
	}

	public void push() {
		g.pose().pushMatrix();
	}

	public void pop() {
		g.pose().popMatrix();
	}

	public void translate(float x, float y) {
		g.pose().translate(x, y);
	}

	public void scale(float x, float y) {
		g.pose().scale(x, y);
	}

	public void item(ItemStack stack, int x, int y) {
		g.renderItem(stack, x, y);
	}

	public void itemDecorations(Font f, ItemStack stack, int x, int y) {
		g.renderItemDecorations(f, stack, x, y);
	}

	public void enableScissor(int x1, int y1, int x2, int y2) {
		g.enableScissor(x1, y1, x2, y2);
	}

	public void disableScissor() {
		g.disableScissor();
	}

	/** One of the panel's 128x128 icons (assets/reminthhud/textures/gui/panel/<name>.png) at size s, tinted (ARGB). */
	public void icon(String name, int x, int y, int s, int color) {
		ResourceLocation id = ResourceLocation.fromNamespaceAndPath("reminthhud", "textures/gui/panel/" + name + ".png");
		g.blit(RenderPipelines.GUI_TEXTURED, id, x, y, 0f, 0f, s, s, 128, 128, 128, 128, color);
	}

	public void setTooltipForNextFrame(Font f, Component c, int x, int y) {
		g.setTooltipForNextFrame(f, c, x, y);
	}

	/** Draws a tooltip asked for during this frame (nothing to do on this version: the game does it). */
	public void flushTooltip() {
	}
}
