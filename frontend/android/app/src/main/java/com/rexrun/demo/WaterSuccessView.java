package com.rexrun.demo;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.view.View;

/** Single celebratory burst after a completed visible drinking cycle; no camera frames retained. */
final class WaterSuccessView extends View {
    private final Paint paint = new Paint();
    private ValueAnimator animator;
    private float progress = 1;
    private static final String[] DROP = {
        "00011000", "00011000", "00111100", "00111100",
        "01111110", "11111111", "11111111", "01111110"
    };

    WaterSuccessView(Context context) {
        super(context);
        setClickable(true);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
        setContentDescription("음수 동작 감지 완료");
    }

    void play() {
        performHapticFeedback(HapticFeedbackConstants.CONFIRM);
        announceForAccessibility(getContentDescription());
        if (Build.VERSION.SDK_INT >= 26 && !ValueAnimator.areAnimatorsEnabled()) return;
        animator = ValueAnimator.ofFloat(0, 1);
        animator.setDuration(850);
        animator.addUpdateListener(
                a -> {
                    progress = (float) a.getAnimatedValue();
                    invalidate();
                });
        animator.start();
    }

    @Override
    protected void onDraw(Canvas c) {
        super.onDraw(c);
        c.drawColor(Color.rgb(50, 86, 105));
        float w = getWidth(), h = getHeight(), unit = Math.min(w / 26f, h / 44f);
        float cx = w / 2, cy = h * .43f;
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(unit / 3);
        paint.setColor(Color.rgb(249, 217, 112));
        float radius = unit * (4 + progress * 6);
        c.drawCircle(cx, cy, radius, paint);
        paint.setStyle(Paint.Style.FILL);
        for (int i = 0; i < 16; i++) {
            double angle = Math.PI * i / 8;
            float r = unit * (5 + progress * (i % 2 == 0 ? 6 : 4));
            float x = cx + (float) Math.cos(angle) * r, y = cy + (float) Math.sin(angle) * r;
            float size = unit * (1 - progress * .5f);
            c.drawRect(x - size / 2, y - size / 2, x + size / 2, y + size / 2, paint);
        }
        float scale = .8f + .2f * Math.min(1, progress * 4);
        float pixel = unit * scale;
        paint.setColor(Color.rgb(143, 212, 230));
        for (int row = 0; row < DROP.length; row++)
            for (int col = 0; col < DROP[row].length(); col++)
                if (DROP[row].charAt(col) == '1')
                    c.drawRect(
                            cx + (col - 4) * pixel,
                            cy + (row - 4) * pixel,
                            cx + (col - 3) * pixel,
                            cy + (row - 3) * pixel,
                            paint);
        paint.setColor(Color.rgb(244, 231, 195));
        paint.setTypeface(Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTextSize(unit * 1.55f);
        c.drawText("음수 동작 감지!", cx, h * .73f, paint);
        paint.setTextSize(unit);
        c.drawText("컵 접근 · 기울임 · 내림 완료", cx, h * .80f, paint);
    }

    @Override
    protected void onDetachedFromWindow() {
        if (animator != null) animator.cancel();
        super.onDetachedFromWindow();
    }
}
