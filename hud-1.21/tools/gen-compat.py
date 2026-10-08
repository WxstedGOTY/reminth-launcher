"""Writes hud-1.21/compat/<family>/client/java/com/wxsted/reminthhud/client/panel/{Gfx,BaseScreen,V}.java."""
import os
ROOT=__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..', 'compat')

FAM={
 # family: versions, id type, pose kind, icon kind, tooltip kind, wordwrap shadow, background kind, input kind, key kind, debug
 'E':dict(v='1.20.1', id='RL_NEW', pose='POSE', icon='SETCOLOR', tip='DEFER', wrap=False, bg='RENDER_1ARG', inp='OLD3', key='STR', dbg='OPTS'),
 'A':dict(v='1.21.1', id='RL', pose='POSE', icon='SETCOLOR', tip='DEFER', wrap=False, bg='RENDER_4ARG', inp='OLD4', key='STR', dbg='OVERLAY'),
 'F':dict(v='1.21.4 and 1.21.5', id='RL', pose='POSE', icon='RENDERTYPE', tip='DEFER', wrap=True, bg='RENDER_4ARG', inp='OLD4', key='STR', dbg='OVERLAY'),
 'B':dict(v='1.21.6 - 1.21.8', id='RL', pose='MATRIX', icon='PIPELINE', tip='NEXTFRAME', wrap=True, bg='SEPARATE', inp='OLD4', key='STR', dbg='OVERLAY'),
 'C':dict(v='1.21.9 and 1.21.10', id='RL', pose='MATRIX', icon='PIPELINE', tip='NEXTFRAME', wrap=True, bg='SEPARATE', inp='EVENTS', key='CAT', dbg='OVERLAY'),
 'D':dict(v='1.21.11', id='ID', pose='MATRIX', icon='PIPELINE', tip='NEXTFRAME', wrap=True, bg='SEPARATE', inp='EVENTS', key='CAT', dbg='OVERLAY'),
}

def gfx(f,c):
    idt = 'Identifier' if c['id']=='ID' else 'ResourceLocation'
    idimp = 'import net.minecraft.resources.Identifier;' if c['id']=='ID' else 'import net.minecraft.resources.ResourceLocation;'
    mk = {'ID':'Identifier.fromNamespaceAndPath', 'RL':'ResourceLocation.fromNamespaceAndPath', 'RL_NEW':'new ResourceLocation'}[c['id']]
    if c['pose']=='MATRIX':
        pose='''	public void push() {
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
	}'''
    else:
        pose='''	public void push() {
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
	}'''
    extra_imp=[]
    if c['icon']=='PIPELINE':
        extra_imp.append('import net.minecraft.client.renderer.RenderPipelines;')
        icon='		g.blit(RenderPipelines.GUI_TEXTURED, id, x, y, 0f, 0f, s, s, 128, 128, 128, 128, color);'
    elif c['icon']=='RENDERTYPE':
        extra_imp.append('import net.minecraft.client.renderer.RenderType;')
        icon='		g.blit(RenderType::guiTextured, id, x, y, 0f, 0f, s, s, 128, 128, 128, 128, color);'
    else:
        extra_imp.append('import com.mojang.blaze3d.systems.RenderSystem;')
        icon='''		// no tint argument on this version: the colour is set around the draw
		RenderSystem.enableBlend();
		g.setColor(((color >> 16) & 0xFF) / 255f, ((color >> 8) & 0xFF) / 255f, (color & 0xFF) / 255f, ((color >>> 24) & 0xFF) / 255f);
		g.blit(id, x, y, s, s, 0f, 0f, 128, 128, 128, 128);
		g.setColor(1f, 1f, 1f, 1f);
		RenderSystem.disableBlend();'''
    if c['tip']=='NEXTFRAME':
        tip='''	public void setTooltipForNextFrame(Font f, Component c, int x, int y) {
		g.setTooltipForNextFrame(f, c, x, y);
	}

	/** Draws a tooltip asked for during this frame (nothing to do on this version: the game does it). */
	public void flushTooltip() {
	}'''
    else:
        tip='''	private Font tipFont;
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
	}'''
    if f in ('E','A'):
        scissor='''		// this version clips in screen units without the current scaling: apply it here
		org.joml.Matrix4f m = g.pose().last().pose();
		org.joml.Vector3f a = m.transformPosition(new org.joml.Vector3f(x1, y1, 0)), b = m.transformPosition(new org.joml.Vector3f(x2, y2, 0));
		g.enableScissor((int) Math.floor(Math.min(a.x, b.x)), (int) Math.floor(Math.min(a.y, b.y)), (int) Math.ceil(Math.max(a.x, b.x)), (int) Math.ceil(Math.max(a.y, b.y)));'''
    else:
        scissor='		g.enableScissor(x1, y1, x2, y2);'
    wrap = 'g.drawWordWrap(f, s, x, y, width, color, shadow);' if c['wrap'] else 'g.drawWordWrap(f, s, x, y, width, color); // no shadow argument on this version'
    imports='\n'.join(sorted(set(['import net.minecraft.client.gui.Font;','import net.minecraft.client.gui.GuiGraphics;','import net.minecraft.network.chat.Component;',idimp,'import net.minecraft.world.item.ItemStack;']+extra_imp)))
    return f'''package com.wxsted.reminthhud.client.panel;

{imports}

/**
 * The panel's drawing calls, for this Minecraft version (compat family {f}: {c['v']} - GuiGraphics).
 * The panel code only draws through this class, so the same panel code builds for every version.
 */
public final class Gfx {{
	private final GuiGraphics g;

	public Gfx(GuiGraphics g) {{
		this.g = g;
	}}

	public GuiGraphics raw() {{
		return g;
	}}

	public int guiWidth() {{
		return g.guiWidth();
	}}

	public int guiHeight() {{
		return g.guiHeight();
	}}

	public void fill(int x1, int y1, int x2, int y2, int color) {{
		g.fill(x1, y1, x2, y2, color);
	}}

	/** A 1 px frame (four lines: the game's own outline call has a different name on some versions). */
	public void outline(int x, int y, int w, int h, int color) {{
		g.fill(x, y, x + w, y + 1, color);
		g.fill(x, y + h - 1, x + w, y + h, color);
		g.fill(x, y + 1, x + 1, y + h - 1, color);
		g.fill(x + w - 1, y + 1, x + w, y + h - 1, color);
	}}

	public void text(Font f, String s, int x, int y, int color, boolean shadow) {{
		g.drawString(f, s, x, y, color, shadow);
	}}

	public void text(Font f, Component s, int x, int y, int color, boolean shadow) {{
		g.drawString(f, s, x, y, color, shadow);
	}}

	public void textWithWordWrap(Font f, Component s, int x, int y, int width, int color, boolean shadow) {{
		{wrap}
	}}

{pose}

	public void item(ItemStack stack, int x, int y) {{
		g.renderItem(stack, x, y);
	}}

	public void itemDecorations(Font f, ItemStack stack, int x, int y) {{
		g.renderItemDecorations(f, stack, x, y);
	}}

	public void enableScissor(int x1, int y1, int x2, int y2) {{
{scissor}
	}}

	public void disableScissor() {{
		g.disableScissor();
	}}

	/** One of the panel's 128x128 icons (assets/reminthhud/textures/gui/panel/<name>.png) at size s, tinted (ARGB). */
	public void icon(String name, int x, int y, int s, int color) {{
		{idt} id = {mk}("reminthhud", "textures/gui/panel/" + name + ".png");
{icon}
	}}

{tip}
}}
'''

def base(f,c):
    imps=['import net.minecraft.client.gui.GuiGraphics;','import net.minecraft.client.gui.screens.Screen;','import net.minecraft.network.chat.Component;']
    # drawing
    if c['bg']=='SEPARATE':
        draw='''	/** The usual background (blur in menus, a dark tint in game). */
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
	}'''
    elif c['bg']=='RENDER_4ARG':
        draw='''	/** The usual background (blur in menus, a dark tint in game). The game draws it inside render() here. */
	protected void drawBackground(Gfx g, int mx, int my, float pt) {
		super.renderBackground(g.raw(), mx, my, pt);
	}

	@Override
	public final void render(GuiGraphics g, int mx, int my, float pt) {
		Gfx gx = new Gfx(g);
		drawBackground(gx, mx, my, pt);
		draw(gx, mx, my, pt);
		gx.flushTooltip();
	}'''
    else:
        draw='''	/** The usual background (a dark tint in game, dirt in menus). 1.20.1 screens draw it themselves. */
	protected void drawBackground(Gfx g, int mx, int my, float pt) {
		super.renderBackground(g.raw());
	}

	@Override
	public final void render(GuiGraphics g, int mx, int my, float pt) {
		Gfx gx = new Gfx(g);
		drawBackground(gx, mx, my, pt);
		draw(gx, mx, my, pt);
		gx.flushTooltip();
	}'''
    if c['inp']=='EVENTS':
        imps+=['import net.minecraft.client.input.CharacterEvent;','import net.minecraft.client.input.KeyEvent;','import net.minecraft.client.input.MouseButtonEvent;']
        inp='''	@Override
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
	}'''
    else:
        imps+=['import net.minecraft.SharedConstants;' if f=='E' else 'import net.minecraft.util.StringUtil;']
        allowed='SharedConstants' if f=='E' else 'StringUtil'
        scroll = '''	@Override
	public boolean mouseScrolled(double x, double y, double sx, double sy) {
		return scroll(x, y, sx, sy) || super.mouseScrolled(x, y, sx, sy);
	}''' if c['inp']=='OLD4' else '''	@Override
	public boolean mouseScrolled(double x, double y, double delta) {
		return scroll(x, y, 0, delta) || super.mouseScrolled(x, y, delta);
	}'''
        inp=f'''	@Override
	public boolean mouseClicked(double x, double y, int button) {{
		return click(x, y, button) || super.mouseClicked(x, y, button);
	}}

	@Override
	public boolean mouseReleased(double x, double y, int button) {{
		return release(x, y, button) || super.mouseReleased(x, y, button);
	}}

	@Override
	public boolean mouseDragged(double x, double y, int button, double dx, double dy) {{
		return drag(x, y, button, dx, dy) || super.mouseDragged(x, y, button, dx, dy);
	}}

{scroll}

	@Override
	public boolean charTyped(char c, int mods) {{
		return ({allowed}.isAllowedChatCharacter(c) && typed(String.valueOf(c))) || super.charTyped(c, mods);
	}}

	@Override
	public boolean keyPressed(int key, int scancode, int mods) {{
		return key(key, scancode, mods) || super.keyPressed(key, scancode, mods);
	}}'''
    imports='\n'.join(sorted(set(imps)))
    return f'''package com.wxsted.reminthhud.client.panel;

{imports}

/**
 * The panel's screens' base, for this Minecraft version (compat family {f}: {c['v']}).
 * Turns the version's drawing and input methods into the plain ones the panel screens use; returning false from one
 * lets the game handle it as usual.
 */
public abstract class BaseScreen extends Screen {{
	protected BaseScreen(Component title) {{
		super(title);
	}}

	protected abstract void draw(Gfx g, int mx, int my, float pt);

	protected boolean click(double x, double y, int button) {{
		return false;
	}}

	protected boolean release(double x, double y, int button) {{
		return false;
	}}

	protected boolean drag(double x, double y, int button, double dx, double dy) {{
		return false;
	}}

	protected boolean scroll(double x, double y, double sx, double sy) {{
		return false;
	}}

	/** A key went down (GLFW key code). */
	protected boolean key(int key, int scancode, int mods) {{
		return false;
	}}

	/** A character was typed (only ones allowed in chat). */
	protected boolean typed(String text) {{
		return false;
	}}

{draw}

{inp}
}}
'''

def vjava(f,c):
    imps=['import com.mojang.blaze3d.platform.InputConstants;','import java.util.function.Consumer;','import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;','import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;','import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;','import net.minecraft.client.KeyMapping;','import net.minecraft.client.Minecraft;','import net.minecraft.client.gui.screens.Screen;']
    if c['key']=='CAT':
        imps.append('import net.minecraft.client.input.KeyEvent;')
        reg='return KeyBindingHelper.registerKeyBinding(new KeyMapping(name, InputConstants.Type.KEYSYM, key, (KeyMapping.Category) category));'
        cat='KeyMapping.Category on this version'
        match='return k.matches(new KeyEvent(key, scancode, mods));'
    else:
        reg='return KeyBindingHelper.registerKeyBinding(new KeyMapping(name, InputConstants.Type.KEYSYM, key, (String) category));'
        cat='a translation key String on this version'
        match='return k.matches(key, scancode);'
    dbg='return mc.options.renderDebug;' if c['dbg']=='OPTS' else 'return mc.getDebugOverlay().showDebugScreen();'
    keypath='key.identifier().getPath()' if c['id']=='ID' else 'key.location().getPath()'
    util='net.minecraft.util.Util' if c['id']=='ID' else 'net.minecraft.Util'
    effects=('return mc.screen instanceof net.minecraft.client.gui.screens.inventory.EffectRenderingInventoryScreen<?> e && e.canSeeEffects();'
             if f in ('E','A') else 'return mc.screen != null && mc.screen.showsActiveEffects();')
    imports='\n'.join(sorted(set(imps)))
    return f'''package com.wxsted.reminthhud.client.panel;

{imports}

/** The few calls that differ between Minecraft versions (compat family {f}: {c['v']}). */
public final class V {{
	private V() {{
	}}

	public static Screen screen(Minecraft mc) {{
		return mc.screen;
	}}

	public static void setScreen(Minecraft mc, Screen s) {{
		mc.setScreen(s);
	}}

	/** A key in Controls (category: {cat}). */
	public static KeyMapping registerKey(String name, int key, Object category) {{
		{reg}
	}}

	public static boolean matches(KeyMapping k, int key, int scancode, int mods) {{
		{match}
	}}

	/** Draws `hud` with the game's HUD. */
	public static void registerHud(Consumer<Gfx> hud) {{
		HudRenderCallback.EVENT.register((g, delta) -> hud.accept(new Gfx(g)));
	}}

	/** F3's screen is open. */
	public static boolean debugShown(Minecraft mc) {{
		{dbg}
	}}

	/** Draws `after` on top of `screen` every frame (for the tips on the title and loading screens). */
	public static void afterDraw(Screen screen, Consumer<Gfx> after) {{
		ScreenEvents.afterRender(screen).register((s, g, mx, my, d) -> after.accept(new Gfx(g)));
	}}

	/** The world's time of day in ticks (0 = morning). */
	public static long dayTime(Minecraft mc) {{
		return mc.level.getDayTime();
	}}

	/** A chat line only this player sees. */
	public static void say(Minecraft mc, net.minecraft.network.chat.Component c) {{
		mc.player.displayClientMessage(c, false);
	}}

	/** "overworld", "the_nether", "plains"...: the path of a dimension's or biome's id. */
	public static String keyPath(net.minecraft.resources.ResourceKey<?> key) {{
		return {keypath};
	}}

	/** The game's millisecond clock (what its own ping measure uses). */
	public static long millis() {{
		return {util}.getMillis();
	}}

	/** The open screen shows the effect list itself (the inventory), so the game draws no effect icons. */
	public static boolean screenShowsEffects(Minecraft mc) {{
		{effects}
	}}
}}
'''

HELPERS_OLD='\n\n\t/** Hunger and saturation the item gives when eaten, or null when it isn\'t food. */\n\tpublic static float[] food(net.minecraft.world.item.ItemStack stack) {\n\t\tnet.minecraft.world.food.FoodProperties f = stack.getItem().getFoodProperties();\n\t\treturn f == null ? null : new float[] {f.getNutrition(), f.getNutrition() * f.getSaturationModifier() * 2f};\n\t}\n\n\t/** Sends the game\'s own ping request (its answer is timed by mixin/PongMixin). */\n\tpublic static void sendPing(Minecraft mc, long time) {\n\t\t// 1.20.1 has no ping request packet (it came in 1.20.2): the player list number is used\n\t}\n\n\t/** The plain "message" screen (saving, joining...). */\n\tpublic static boolean isMessageScreen(net.minecraft.client.gui.screens.Screen s) {\n\t\treturn false; // 1.20.1 has no GenericMessageScreen\n\t}\n\n\t/** A good effect (the game draws those on the top row). */\n\tpublic static boolean beneficial(net.minecraft.world.effect.MobEffectInstance e) {\n\t\treturn e.getEffect().isBeneficial();\n\t}\n\n\t/** Lines added under every item tooltip. */\n\tpublic static void onTooltip(java.util.function.BiConsumer<net.minecraft.world.item.ItemStack, java.util.List<net.minecraft.network.chat.Component>> add) {\n\t\tnet.fabricmc.fabric.api.client.item.v1.ItemTooltipCallback.EVENT.register((stack, flag, lines) -> add.accept(stack, lines));\n\t}\n\n\t/** The game\'s Controls screen (Key Binds). */\n\tpublic static net.minecraft.client.gui.screens.Screen controlsScreen(net.minecraft.client.gui.screens.Screen parent, net.minecraft.client.Options options) {\n\t\treturn new net.minecraft.client.gui.screens.controls.KeyBindsScreen(parent, options);\n\t}\n}\n'
HELPERS_NEW='\n\n\t/** Hunger and saturation the item gives when eaten, or null when it isn\'t food. */\n\tpublic static float[] food(net.minecraft.world.item.ItemStack stack) {\n\t\tnet.minecraft.world.food.FoodProperties f = stack.get(net.minecraft.core.component.DataComponents.FOOD);\n\t\treturn f == null ? null : new float[] {f.nutrition(), f.saturation()};\n\t}\n\n\t/** Sends the game\'s own ping request (its answer is timed by mixin/PongMixin). */\n\tpublic static void sendPing(Minecraft mc, long time) {\n\t\tmc.getConnection().send(new net.minecraft.network.protocol.ping.ServerboundPingRequestPacket(time));\n\t}\n\n\t/** The plain "message" screen (saving, joining...). */\n\tpublic static boolean isMessageScreen(net.minecraft.client.gui.screens.Screen s) {\n\t\treturn s instanceof net.minecraft.client.gui.screens.GenericMessageScreen;\n\t}\n\n\t/** A good effect (the game draws those on the top row). */\n\tpublic static boolean beneficial(net.minecraft.world.effect.MobEffectInstance e) {\n\t\treturn e.getEffect().value().isBeneficial();\n\t}\n\n\t/** Lines added under every item tooltip. */\n\tpublic static void onTooltip(java.util.function.BiConsumer<net.minecraft.world.item.ItemStack, java.util.List<net.minecraft.network.chat.Component>> add) {\n\t\tnet.fabricmc.fabric.api.client.item.v1.ItemTooltipCallback.EVENT.register((stack, context, flag, lines) -> add.accept(stack, lines));\n\t}\n\n\t/** The game\'s Controls screen (Key Binds). */\n\tpublic static net.minecraft.client.gui.screens.Screen controlsScreen(net.minecraft.client.gui.screens.Screen parent, net.minecraft.client.Options options) {\n\t\treturn new net.minecraft.client.gui.screens.options.controls.KeyBindsScreen(parent, options);\n\t}\n}\n'
HELPERS_POINTER='\n\n\t/** The game is in full screen. */\n\tpublic static boolean isFullscreen(Minecraft mc) {\n\t\treturn mc.getWindow().isFullscreen();\n\t}\n\n\t/** Shows or hides the Windows mouse pointer over the game (SoftCursor draws its own in full screen). */\n\tpublic static void osPointer(Minecraft mc, boolean visible) {\n\t\torg.lwjgl.glfw.GLFW.glfwSetInputMode(HANDLE, org.lwjgl.glfw.GLFW.GLFW_CURSOR, visible ? org.lwjgl.glfw.GLFW.GLFW_CURSOR_NORMAL : org.lwjgl.glfw.GLFW.GLFW_CURSOR_HIDDEN);\n\t}\n}\n'
for f,c in FAM.items():
    d=f'{ROOT}/{f}/client/java/com/wxsted/reminthhud/client/panel'
    os.makedirs(d,exist_ok=True)
    for name,fn in (('Gfx',gfx),('BaseScreen',base),('V',vjava)):
        src=fn(f,c)
        if name=='V':
            i=src.rindex('}')
            src=src[:i].rstrip('\n')+(HELPERS_OLD if f=='E' else HELPERS_NEW)
            handle='mc.getWindow().handle()' if f in ('C','D') else 'mc.getWindow().getWindow()'
            i=src.rindex('}')
            src=src[:i].rstrip('\n')+HELPERS_POINTER.replace('HANDLE', handle)
        open(f'{d}/{name}.java','w',encoding='utf-8',newline='\n').write(src)
print('written', list(FAM))
