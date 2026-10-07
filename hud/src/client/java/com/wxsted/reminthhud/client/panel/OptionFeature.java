package com.wxsted.reminthhud.client.panel;

import java.util.Locale;
import java.util.function.Function;

import com.wxsted.reminthhud.ReminthHud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.OptionInstance;
import net.minecraft.client.Options;

/**
 * A feature that is one of the game's own settings, brought into the panel: while it is on, the setting has the value
 * chosen here; switched off, the setting goes back to what it was before (remembered in the profile, also across
 * restarts). Nothing the game itself doesn't offer.
 */
public final class OptionFeature extends Module {
	private enum Kind { BOOL, PERCENT, INT, CHOICE }

	private final Function<Options, OptionInstance<?>> getter;
	private final Kind kind;
	private final boolean boolWant;
	private Opt.Num num;
	private Opt.Choice choice;
	private Object[] constants;
	private final double numScale;
	private int ticks;

	private OptionFeature(String id, String name, Cat cat, String icon, String desc, Function<Options, OptionInstance<?>> getter, Kind kind, boolean boolWant, double numScale) {
		super(id, name, cat, icon, desc, true, false, null, 0, 0);
		this.getter = getter;
		this.kind = kind;
		this.boolWant = boolWant;
		this.numScale = numScale;
	}

	/** On = the setting is `want` (e.g. "No view bobbing": bobView = false). */
	public static OptionFeature bool(String id, String name, Cat cat, String icon, String desc, Function<Options, OptionInstance<Boolean>> getter, boolean want) {
		return new OptionFeature(id, name, cat, icon, desc, o -> getter.apply(o), Kind.BOOL, want, 1);
	}

	/** A 0..1 setting shown in % (min..max %). */
	public static OptionFeature percent(String id, String name, Cat cat, String icon, String desc, Function<Options, OptionInstance<Double>> getter, String label, double min, double max, double step, double def) {
		OptionFeature f = new OptionFeature(id, name, cat, icon, desc, o -> getter.apply(o), Kind.PERCENT, false, 100);
		f.num = f.opt(new Opt.Num("value", label, min, max, step, def, "%"));
		return f;
	}

	/** A plain number setting (doubles with a unit, e.g. seconds). */
	public static OptionFeature number(String id, String name, Cat cat, String icon, String desc, Function<Options, OptionInstance<Double>> getter, String label, double min, double max, double step, double def, String unit) {
		OptionFeature f = new OptionFeature(id, name, cat, icon, desc, o -> getter.apply(o), Kind.PERCENT, false, 1);
		f.num = f.opt(new Opt.Num("value", label, min, max, step, def, unit));
		return f;
	}

	/** A whole-number setting. */
	public static OptionFeature integer(String id, String name, Cat cat, String icon, String desc, Function<Options, OptionInstance<Integer>> getter, String label, int min, int max, int step, int def, String unit) {
		OptionFeature f = new OptionFeature(id, name, cat, icon, desc, o -> getter.apply(o), Kind.INT, false, 1);
		f.num = f.opt(new Opt.Num("value", label, min, max, step, def, unit));
		return f;
	}

	/** One of the setting's own choices (an enum). Labels follow `constants` order. */
	public static OptionFeature choice(String id, String name, Cat cat, String icon, String desc, Function<Options, OptionInstance<?>> getter, String label, Object[] constants, int def) {
		OptionFeature f = new OptionFeature(id, name, cat, icon, desc, getter, Kind.CHOICE, false, 1);
		f.constants = constants;
		String[] labels = new String[constants.length];
		for (int i = 0; i < constants.length; i++) labels[i] = pretty(constants[i].toString());
		f.choice = f.opt(new Opt.Choice("value", label, def, labels));
		return f;
	}

	static String pretty(String s) {
		String t = s.replace('_', ' ').toLowerCase(Locale.ROOT);
		return t.isEmpty() ? t : Character.toUpperCase(t.charAt(0)) + t.substring(1);
	}

	@SuppressWarnings("unchecked")
	private OptionInstance<Object> inst(Minecraft mc) {
		return (OptionInstance<Object>) getter.apply(mc.options);
	}

	private Object wanted() {
		return switch (kind) {
			case BOOL -> boolWant;
			case PERCENT -> num.value / numScale;
			case INT -> (int) Math.round(num.value);
			case CHOICE -> constants[Math.max(0, Math.min(constants.length - 1, choice.value))];
		};
	}

	private static String encode(Object v) {
		return v instanceof Enum<?> e ? e.name() : String.valueOf(v);
	}

	@SuppressWarnings({"unchecked", "rawtypes"})
	private static Object decode(String s, Object like) {
		try {
			if (like instanceof Boolean) return Boolean.parseBoolean(s);
			if (like instanceof Integer) return Integer.parseInt(s);
			if (like instanceof Double) return Double.parseDouble(s);
			if (like instanceof Enum<?> e) return Enum.valueOf((Class) e.getDeclaringClass(), s);
		} catch (RuntimeException ignored) {
			// unreadable: leave the setting as it is
		}
		return null;
	}

	private void apply(Minecraft mc) {
		OptionInstance<Object> oi = inst(mc);
		Object want = wanted();
		Object cur = oi.get();
		boolean same = cur instanceof Double d && want instanceof Double w ? Math.abs(d - w) < 1e-6 : cur.equals(want);
		if (!same) oi.set(want);
	}

	@Override
	public void onEnable(Minecraft mc) {
		try {
			if (restore == null) restore = encode(inst(mc).get());
			apply(mc);
		} catch (Throwable t) {
			ReminthHud.LOGGER.warn("Reminth panel: {} couldn't change its setting ({})", id, t.toString());
		}
	}

	@Override
	public void tick(Minecraft mc) {
		if (++ticks % 10 != 0) return; // twice a second is plenty (also on the title screen)
		try {
			apply(mc);
		} catch (Throwable ignored) {
			// a value the game refuses stays as it is
		}
	}

	@Override
	public void onDisable(Minecraft mc) {
		try {
			OptionInstance<Object> oi = inst(mc);
			if (restore != null) {
				Object back = decode(restore, oi.get());
				if (back != null) oi.set(back);
			}
		} catch (Throwable t) {
			ReminthHud.LOGGER.warn("Reminth panel: {} couldn't put its setting back ({})", id, t.toString());
		}
		restore = null;
	}
}
