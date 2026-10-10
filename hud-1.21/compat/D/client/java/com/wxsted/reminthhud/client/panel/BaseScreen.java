package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/**
 * The panel's screens' base, for this Minecraft version (compat family D: 1.21.11).
 * Turns the version's drawing and input methods into the plain ones the panel screens use; returning false from one
 * lets the game handle it as usual.
 */
public abstract class BaseScreen extends Screen {
	protected BaseScreen(Component title) {
		super(title);
	}

	protected abstract void draw(Gfx g, int mx, int my, float pt);

	protected boolean click(double x, double y, int button) {
		return false;
	}

	protected boolean release(double x, double y, int button) {
		return false;
	}

	protected boolean drag(double x, double y, int button, double dx, double dy) {
		return false;
	}

	protected boolean scroll(double x, double y, double sx, double sy) {
		return false;
	}

	/** A key went up (GLFW key code). */
	protected boolean keyUp(int key, int scancode, int mods) {
		return false;
	}

	/** A key went down (GLFW key code). */
	protected boolean key(int key, int scancode, int mods) {
		return false;
	}

	/** A character was typed (only ones allowed in chat). */
	protected boolean typed(String text) {
		return false;
	}

	/** The usual background (blur in menus, a dark tint in game). */
	protected void drawBackground(Gfx g, int mx, int my, float pt) {
		super.renderBackground(g.raw(), mx, my, pt);
	}

	@Override
	public final void renderBackground(GuiGraphics g, int mx, int my, float pt) {
		drawBackground(new Gfx(g), mx, my, pt);
	}

	@Override
	public final void render(GuiGraphics g, int mx, int my, float pt) {
		Gfx gx = new Gfx(g);
		draw(gx, mx, my, pt);
		gx.flushTooltip();
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean doubleClick) {
		return click(e.x(), e.y(), e.button()) || super.mouseClicked(e, doubleClick);
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent e) {
		return release(e.x(), e.y(), e.button()) || super.mouseReleased(e);
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent e, double dx, double dy) {
		return drag(e.x(), e.y(), e.button(), dx, dy) || super.mouseDragged(e, dx, dy);
	}

	@Override
	public boolean mouseScrolled(double x, double y, double sx, double sy) {
		return scroll(x, y, sx, sy) || super.mouseScrolled(x, y, sx, sy);
	}

	@Override
	public boolean charTyped(CharacterEvent e) {
		return (e.isAllowedChatCharacter() && typed(e.codepointAsString())) || super.charTyped(e);
	}

	@Override
	public boolean keyPressed(KeyEvent e) {
		return key(e.key(), e.scancode(), e.modifiers()) || super.keyPressed(e);
	}

	@Override
	public boolean keyReleased(KeyEvent e) {
		return keyUp(e.key(), e.scancode(), e.modifiers()) || super.keyReleased(e);
	}
}
