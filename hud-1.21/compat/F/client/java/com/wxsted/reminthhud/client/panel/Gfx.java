package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;

/**
 * The panel's drawing calls, for this Minecraft version (compat family F: 1.21.4 and 1.21.5 - GuiGraphics).
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
		g.enableScissor(x1, y1, x2, y2);
	}

	public void disableScissor() {
		g.disableScissor();
	}

	/** One of the panel's 128x128 icons (assets/reminthhud/textures/gui/panel/<name>.png) at size s, tinted (ARGB). */
	public void icon(String name, int x, int y, int s, int color) {
		ResourceLocation id = ResourceLocation.fromNamespaceAndPath("reminthhud", "textures/gui/panel/" + name + ".png");
		g.blit(RenderType::guiTextured, id, x, y, 0f, 0f, s, s, 128, 128, 128, 128, color);
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
