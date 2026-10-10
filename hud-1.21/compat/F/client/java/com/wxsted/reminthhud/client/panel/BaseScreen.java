package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.util.StringUtil;

/**
 * The panel's screens' base, for this Minecraft version (compat family F: 1.21.4 and 1.21.5).
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

	/** The usual background (blur in menus, a dark tint in game). The game draws it inside render() here. */
	protected void drawBackground(Gfx g, int mx, int my, float pt) {
		super.renderBackground(g.raw(), mx, my, pt);
	}

	@Override
	public final void render(GuiGraphics g, int mx, int my, float pt) {
		Gfx gx = new Gfx(g);
		drawBackground(gx, mx, my, pt);
		draw(gx, mx, my, pt);
		gx.flushTooltip();
	}

	@Override
	public boolean mouseClicked(double x, double y, int button) {
		return click(x, y, button) || super.mouseClicked(x, y, button);
	}

	@Override
	public boolean mouseReleased(double x, double y, int button) {
		return release(x, y, button) || super.mouseReleased(x, y, button);
	}

	@Override
	public boolean mouseDragged(double x, double y, int button, double dx, double dy) {
		return drag(x, y, button, dx, dy) || super.mouseDragged(x, y, button, dx, dy);
	}

	@Override
	public boolean mouseScrolled(double x, double y, double sx, double sy) {
		return scroll(x, y, sx, sy) || super.mouseScrolled(x, y, sx, sy);
	}

	@Override
	public boolean charTyped(char c, int mods) {
		return (StringUtil.isAllowedChatCharacter(c) && typed(String.valueOf(c))) || super.charTyped(c, mods);
	}

	@Override
	public boolean keyPressed(int key, int scancode, int mods) {
		return key(key, scancode, mods) || super.keyPressed(key, scancode, mods);
	}

	@Override
	public boolean keyReleased(int key, int scancode, int mods) {
		return keyUp(key, scancode, mods) || super.keyReleased(key, scancode, mods);
	}
}
