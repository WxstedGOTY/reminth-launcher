import java.awt.*;
import java.awt.geom.*;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/** Draws the five 32x32 title-screen icons (light grey, transparent). Run: java IconGen.java <outDir> */
public class IconGen {
	static final Color C = new Color(0xE6E6EA);

	static BufferedImage canvas() {
		return new BufferedImage(32, 32, BufferedImage.TYPE_INT_ARGB);
	}

	static Graphics2D g(BufferedImage b) {
		Graphics2D g = b.createGraphics();
		g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
		g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
		g.setColor(C);
		g.setStroke(new BasicStroke(2.6f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
		return g;
	}

	public static void main(String[] a) throws Exception {
		File d = new File(a[0]);
		d.mkdirs();
		BufferedImage b;
		Graphics2D g;
		// skins: head and shoulders
		b = canvas();
		g = g(b);
		g.fill(new Ellipse2D.Double(10.5, 4, 11, 11));
		Path2D sh = new Path2D.Double();
		sh.moveTo(5, 28);
		sh.curveTo(5, 19, 10, 17, 16, 17);
		sh.curveTo(22, 17, 27, 19, 27, 28);
		sh.closePath();
		g.fill(sh);
		ImageIO.write(b, "png", new File(d, "skins.png"));
		// mods: cube
		b = canvas();
		g = g(b);
		Path2D hex = new Path2D.Double();
		hex.moveTo(16, 4);
		hex.lineTo(27, 10);
		hex.lineTo(27, 22);
		hex.lineTo(16, 28);
		hex.lineTo(5, 22);
		hex.lineTo(5, 10);
		hex.closePath();
		g.draw(hex);
		g.draw(new Line2D.Double(5, 10, 16, 16));
		g.draw(new Line2D.Double(27, 10, 16, 16));
		g.draw(new Line2D.Double(16, 16, 16, 28));
		ImageIO.write(b, "png", new File(d, "mods.png"));
		// options: gear
		b = canvas();
		g = g(b);
		Area gear = new Area(new Ellipse2D.Double(8, 8, 16, 16));
		for (int i = 0; i < 8; i++) {
			AffineTransform t = AffineTransform.getRotateInstance(i * Math.PI / 4, 16, 16);
			gear.add(new Area(t.createTransformedShape(new RoundRectangle2D.Double(13, 3.5, 6, 25, 2, 2))));
		}
		gear.subtract(new Area(new Ellipse2D.Double(12, 12, 8, 8)));
		g.fill(gear);
		ImageIO.write(b, "png", new File(d, "options.png"));
		// language: globe
		b = canvas();
		g = g(b);
		g.draw(new Ellipse2D.Double(5, 5, 22, 22));
		g.draw(new Ellipse2D.Double(11, 5, 10, 22));
		g.draw(new Line2D.Double(5, 16, 27, 16));
		g.draw(new Line2D.Double(7.5, 10.5, 24.5, 10.5));
		g.draw(new Line2D.Double(7.5, 21.5, 24.5, 21.5));
		ImageIO.write(b, "png", new File(d, "language.png"));
		// quit: power symbol
		b = canvas();
		g = g(b);
		g.draw(new Arc2D.Double(6, 7, 20, 20, 120, -300, Arc2D.OPEN));
		g.draw(new Line2D.Double(16, 4, 16, 15));
		ImageIO.write(b, "png", new File(d, "quit.png"));
	}
}
