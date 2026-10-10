package com.wxsted.reminthhud.client.panel;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;

/** One setting of a feature, saved per profile. */
public abstract class Opt {
	public final String key;
	public final String label;

	Opt(String key, String label) {
		this.key = key;
		this.label = label;
	}

	abstract void reset();

	abstract JsonElement save();

	abstract void load(JsonElement e);

	/** On/off. */
	public static final class Bool extends Opt {
		public final boolean def;
		public boolean value;

		public Bool(String key, String label, boolean def) {
			super(key, label);
			this.def = def;
			this.value = def;
		}

		@Override
		void reset() {
			value = def;
		}

		@Override
		JsonElement save() {
			return new JsonPrimitive(value);
		}

		@Override
		void load(JsonElement e) {
			if (e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isBoolean()) value = e.getAsBoolean();
		}
	}

	/** A number on a slider. */
	public static final class Num extends Opt {
		public final double min, max, step, def;
		public final String unit;
		public double value;

		public Num(String key, String label, double min, double max, double step, double def, String unit) {
			super(key, label);
			this.min = min;
			this.max = max;
			this.step = step;
			this.def = def;
			this.unit = unit;
			this.value = def;
		}

		public void set(double v) {
			v = Math.max(min, Math.min(max, v));
			value = Math.round(v / step) * step;
		}

		public String shown() {
			String n = step >= 1 ? Long.toString(Math.round(value)) : String.format(java.util.Locale.ROOT, "%.1f", value);
			return n + unit;
		}

		@Override
		void reset() {
			value = def;
		}

		@Override
		JsonElement save() {
			return new JsonPrimitive(value);
		}

		@Override
		void load(JsonElement e) {
			if (e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isNumber()) set(e.getAsDouble());
		}
	}

	/** A colour picked from a row of swatches. */
	public static final class Color extends Opt {
		public static final int[] SWATCHES = {0xFFFFFFFF, 0xFFB4B4B8, 0xFF555555, 0xFF000000, 0xFFFF5555, 0xFFAA0000, 0xFFFFAA00, 0xFFFFFF55, 0xFF55FF55, 0xFF00AA00, 0xFF55FFFF, 0xFF5599FF, 0xFF0000AA, 0xFFAA00AA, 0xFFFF55FF};
		public final int def;
		public int value;

		public Color(String key, String label, int def) {
			super(key, label);
			this.def = def;
			this.value = def;
		}

		@Override
		void reset() {
			value = def;
		}

		@Override
		JsonElement save() {
			return new JsonPrimitive(String.format("#%08X", value));
		}

		@Override
		void load(JsonElement e) {
			try {
				if (e != null && e.isJsonPrimitive()) value = (int) Long.parseLong(e.getAsString().replace("#", ""), 16);
			} catch (NumberFormatException ignored) {
				// keep the default
			}
		}
	}

	/** One of a few named choices. */
	public static final class Choice extends Opt {
		public final String[] choices;
		public final int def;
		public int value;

		public Choice(String key, String label, int def, String... choices) {
			super(key, label);
			this.choices = choices;
			this.def = def;
			this.value = def;
		}

		public String shown() {
			return choices[Math.max(0, Math.min(choices.length - 1, value))];
		}

		@Override
		void reset() {
			value = def;
		}

		@Override
		JsonElement save() {
			return new JsonPrimitive(value);
		}

		@Override
		void load(JsonElement e) {
			if (e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isNumber()) value = Math.max(0, Math.min(choices.length - 1, e.getAsInt()));
		}
	}

	/** A line of text the player types (Stream Text, labels...). */
	public static final class Text extends Opt {
		public final String def;
		public final int max;
		public String value;

		public Text(String key, String label, String def, int max) {
			super(key, label);
			this.def = def;
			this.max = max;
			this.value = def;
		}

		@Override
		void reset() {
			value = def;
		}

		@Override
		JsonElement save() {
			return new JsonPrimitive(value);
		}

		@Override
		void load(JsonElement e) {
			if (e != null && e.isJsonPrimitive()) {
				String v = e.getAsString();
				value = v.length() > max ? v.substring(0, max) : v;
			}
		}
	}

	/** A heading between options (saves nothing). */
	public static final class Label extends Opt {
		public Label(String label) {
			super("_label_" + label, label);
		}

		@Override
		void reset() {
		}

		@Override
		JsonElement save() {
			return null;
		}

		@Override
		void load(JsonElement e) {
		}
	}

	static JsonObject saveAll(java.util.List<Opt> opts) {
		JsonObject o = new JsonObject();
		for (Opt opt : opts) {
			JsonElement e = opt.key.startsWith("_") ? null : opt.save();
			if (e != null) o.add(opt.key, e);
		}
		return o;
	}

	static void loadAll(java.util.List<Opt> opts, JsonObject o) {
		for (Opt opt : opts) {
			if (opt.key.startsWith("_")) continue;
			opt.reset();
			if (o != null) opt.load(o.get(opt.key));
		}
	}
}
