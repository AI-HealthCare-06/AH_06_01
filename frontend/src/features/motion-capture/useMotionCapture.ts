import { useCallback, useEffect, useRef, useState } from "react";
import {
  InjectionDetector,
  injectionConfig,
  sampleInjection,
  type InjectionRegion,
  type InjectionObservation,
} from "./injection";
import { manifestVersion, motionConfig } from "./config";
import { ProcessDetector, processConfig } from "./process";
import { sampleProcess } from "./process-sample";
import { MotionDetector } from "./detector";
import { inferenceFrame } from "./frame";
import { sampleObservation } from "./sample";
import type {
  DetectionProgress,
  InputSource,
  MotionObservation,
  ProcessObservation,
  MotionQuest,
  MotionResult,
  WorkerResponse,
} from "./types";

const initialProgress: DetectionProgress = {
  stage: "ready",
  holdProgress: 0,
  validObservationRatio: 0,
  message: "얼굴과 동작 대상을 화면에 담아 주세요.",
};
type CaptureState = {
  phase: "idle" | "loading" | "observing" | "result" | "error";
  source: InputSource | null;
  message: string;
  progress: DetectionProgress;
  observation: MotionObservation | null;
  result: MotionResult | null;
  latencyMs: number | null;
};
const initialState: CaptureState = {
  phase: "idle",
  source: null,
  message: initialProgress.message,
  progress: initialProgress,
  observation: null,
  result: null,
  latencyMs: null,
};

const uniqueId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function useMotionCapture(profile: "motion" | "process" | "injection" = "motion") {
  const video = useRef<HTMLVideoElement>(null);
  const bindVideo = useCallback((element: HTMLVideoElement | null) => {
    video.current = element;
  }, []);
  const [state, setState] = useState<CaptureState>(initialState);
  const [selectedRegion, setSelectedRegion] = useState<InjectionRegion | null>(null);
  const regionRef = useRef<InjectionRegion | null>(null);
  const selectRegion = useCallback((region: InjectionRegion) => {
    regionRef.current = region;
    setSelectedRegion(region);
  }, []);
  const generation = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const worker = useRef<Worker | null>(null);
  const animation = useRef<number | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rejectReady = useRef<((reason: Error) => void) | null>(null);

  const cleanup = useCallback(() => {
    generation.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    worker.current?.terminate();
    worker.current = null;
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    if (interval.current !== null) clearInterval(interval.current);
    if (timeout.current !== null) clearTimeout(timeout.current);
    animation.current = null;
    interval.current = null;
    timeout.current = null;
    rejectReady.current?.(new Error("Session closed"));
    rejectReady.current = null;
  }, [video]);

  const cancel = useCallback(() => {
    cleanup();
    setState({ ...initialState, message: "촬영을 종료했어요. 다시 시작할 수 있어요." });
  }, [cleanup]);

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      cleanup();
    };
  }, [cancel, cleanup]);

  const start = useCallback(
    async (quest: MotionQuest, source: InputSource, preparation: boolean) => {
      cleanup();
      regionRef.current = null;
      setSelectedRegion(null);
      if (profile === "injection" && source === "sample") {
        regionRef.current = { x: 0.5, y: 0.6, radius: 0.12 };
        setSelectedRegion(regionRef.current);
      }
      let injectionDetector: InjectionDetector | null = null;
      let detectorRegion: InjectionRegion | null = null;
      const token = generation.current;
      const sessionId = uniqueId();
      const detector = new MotionDetector(quest, preparation);
      const processDetector =
        profile === "process" ? new ProcessDetector(quest, preparation) : null;
      let progress = {
        ...initialProgress,
        message:
          profile === "process"
            ? "얼굴과 손을 담고, 컵을 입 아래에 잠깐 보여 주세요."
            : quest === "water"
              ? "셀카처럼 얼굴과 컵을 담아 주세요. 손과 컵 바닥은 잘려도 괜찮아요."
              : "얼굴과 약을 준비한 손이 함께 보이도록 담아 주세요.",
      };
      let observedAt = performance.now();
      let startedAt = new Date().toISOString();
      const active = () => token === generation.current;
      const fail = (message: string) => {
        if (!active()) return;
        cleanup();
        setState({ ...initialState, phase: "error", source, message });
      };
      const finish = (decision: "detected" | "inconclusive", message: string) => {
        if (!active()) return;
        const result: MotionResult = {
          schemaVersion: 1,
          sessionId,
          eventId: decision === "detected" ? uniqueId() : null,
          questId: quest,
          inputSource: source,
          kind:
            decision === "detected"
              ? profile === "injection"
                ? "injection_site_hand_process"
                : quest === "water"
                  ? "drinking_motion"
                  : processDetector
                    ? "oral_medication_process"
                    : "hand_to_mouth_motion"
              : null,
          decision,
          detector:
            profile === "injection"
              ? "injection_rules_v1"
              : processDetector
                ? "process_rules_v2"
                : "rules_v1",
          ...(progress.process ? { process: progress.process } : {}),
          modelManifestVersion: manifestVersion,
          configVersion:
            profile === "injection"
              ? injectionConfig.version
              : processDetector
                ? processConfig.version
                : motionConfig.version,
          startedAt,
          endedAt: new Date().toISOString(),
          durationMs: Math.round(performance.now() - observedAt),
          validObservationRatio: progress.validObservationRatio,
          classificationScore: null,
          preparationSource: quest === "medicine" ? "user_ack" : "not_required",
          verificationLevel: profile !== "motion" ? "experimental_process" : "local_demo",
          userConfirmed: false,
          reasonCodes: decision === "detected" ? [] : ["observation_timeout"],
        };
        cleanup();
        setState({
          phase: "result",
          source,
          result,
          progress,
          message,
          observation: null,
          latencyMs: null,
        });
      };
      const consume = (
        observation: MotionObservation,
        latencyMs: number | null,
        process?: ProcessObservation,
        injection?: InjectionObservation,
      ) => {
        if (!active()) return;
        if (profile === "injection" && regionRef.current !== detectorRegion) {
          detectorRegion = regionRef.current;
          injectionDetector = detectorRegion ? new InjectionDetector(detectorRegion) : null;
        }
        progress =
          profile === "injection"
            ? injectionDetector
              ? injectionDetector.update(
                  injection ?? {
                    timestamp: observation.timestamp,
                    frameWidth: observation.frameWidth,
                    frameHeight: observation.frameHeight,
                    hands: [],
                  },
                )
              : { ...initialProgress, message: "영상에서 관찰할 투약 부위를 터치해 지정해 주세요." }
            : processDetector
              ? processDetector.update(
                  process ?? {
                    hand: { ...observation, valid: false, mouth: null },
                    drink: { ...observation, valid: false, mouth: null },
                  },
                )
              : detector.update(observation);
        if (progress.stage === "detected") finish("detected", progress.message);
        else
          setState((current) => ({
            ...current,
            progress,
            observation: injection
              ? { ...observation, mouth: null, object: null, hand: injection.hands[0] ?? null }
              : process && progress.process?.phase !== "hand"
                ? process.drink
                : observation,
            latencyMs,
            message: progress.message,
          }));
      };
      const observe = () => {
        observedAt = performance.now();
        startedAt = new Date().toISOString();
        if (timeout.current !== null) clearTimeout(timeout.current);
        timeout.current = setTimeout(
          () =>
            finish(
              "inconclusive",
              "동작을 충분히 확인하지 못했어요. 수동 기록을 이용하거나 촬영을 다시 시작해 주세요.",
            ),
          motionConfig.timeoutMs,
        );
        setState((current) => ({
          ...current,
          phase: "observing",
          message: progress.message,
        }));
      };
      setState({
        ...initialState,
        phase: "loading",
        source,
        message:
          source === "sample"
            ? "샘플 동작을 준비하고 있어요…"
            : "카메라와 인식 모델을 준비하고 있어요…",
      });
      if (quest === "medicine" && !preparation) {
        fail("약 준비 확인을 먼저 선택해 주세요.");
        return;
      }
      if (source === "sample") {
        observe();
        let sampleTime = 0;
        interval.current = setInterval(() => {
          sampleTime += motionConfig.frameIntervalMs;
          const process = processDetector
            ? sampleProcess(quest, sampleTime, observedAt + sampleTime)
            : undefined;
          consume(
            process
              ? quest === "medicine"
                ? process.hand
                : process.drink
              : sampleObservation(quest, sampleTime, observedAt + sampleTime),
            null,
            process,
            profile === "injection"
              ? sampleInjection(sampleTime, observedAt + sampleTime)
              : undefined,
          );
        }, motionConfig.frameIntervalMs);
        return;
      }
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        fail(
          "카메라는 HTTPS 또는 localhost 환경에서 사용할 수 있어요. 샘플 동작은 바로 확인할 수 있어요.",
        );
        return;
      }
      if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap) {
        fail(
          "이 브라우저는 동작 인식을 지원하지 않아요. 최신 브라우저 또는 샘플 동작을 이용해 주세요.",
        );
        return;
      }
      try {
        const inference = new Worker(new URL("./inference.worker.ts", import.meta.url), {
          type: "module",
        });
        worker.current = inference;
        let inFlight = false;
        const ready = new Promise<void>((resolve, reject) => {
          rejectReady.current = reject;
          inference.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
            if (!active() || data.sessionId !== sessionId) return;
            if (data.type === "ready") {
              rejectReady.current = null;
              resolve();
            } else if (data.type === "loading")
              setState((current) => ({ ...current, message: data.message }));
            else if (data.type === "error") fail(data.message);
            else {
              inFlight = false;
              consume(
                data.observation,
                Math.round(performance.now() - data.observation.timestamp),
                data.process,
                data.injection,
              );
            }
          };
          inference.onerror = () =>
            fail("인식 기능을 실행하지 못했어요. 다시 시도하거나 샘플 동작을 이용해 주세요.");
        });
        void ready.catch(() => {});
        inference.postMessage({
          type: "init",
          sessionId,
          quest,
          process: profile === "process",
          injection: profile === "injection",
          baseUrl: window.location.origin,
        });
        timeout.current = setTimeout(
          () => fail("카메라와 모델 준비 시간이 길어졌어요. 권한을 확인한 뒤 다시 시작해 주세요."),
          motionConfig.loadingTimeoutMs,
        );
        const nextStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 960 },
            height: { ideal: 1280 },
            aspectRatio: { ideal: 3 / 4 },
          },
          audio: false,
        });
        if (!active()) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = nextStream;
        nextStream.getVideoTracks().forEach((track) => {
          track.addEventListener(
            "ended",
            () =>
              fail("카메라 연결이 끊어졌어요. 권한과 기기 상태를 확인한 뒤 다시 시작해 주세요."),
            { once: true },
          );
        });
        const element = video.current;
        if (!element) {
          fail("카메라 화면을 준비하지 못했어요.");
          return;
        }
        element.srcObject = nextStream;
        await element.play();
        await ready;
        if (!active()) return;
        observe();
        let lastFrameAt = -Infinity;
        let lastVideoTime = -1;
        const frame = (now: number) => {
          if (!active()) return;
          animation.current = requestAnimationFrame(frame);
          if (
            inFlight ||
            now - lastFrameAt < motionConfig.frameIntervalMs ||
            !element.videoWidth ||
            element.currentTime === lastVideoTime
          )
            return;
          inFlight = true;
          lastFrameAt = now;
          lastVideoTime = element.currentTime;
          const crop = inferenceFrame(
            element.videoWidth,
            element.videoHeight,
            profile !== "motion" ? element.videoWidth / element.videoHeight : 3 / 4,
          );
          void createImageBitmap(element, crop.x, crop.y, crop.width, crop.height, {
            resizeWidth: crop.resizeWidth,
            resizeHeight: crop.resizeHeight,
          })
            .then((image) => {
              if (!active()) {
                image.close();
                return;
              }
              inference.postMessage({ type: "frame", sessionId, image, timestamp: now }, [image]);
            })
            .catch(() => fail("카메라 프레임을 읽지 못했어요. 촬영을 다시 시작해 주세요."));
        };
        animation.current = requestAnimationFrame(frame);
      } catch (error) {
        fail(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "카메라 권한을 허용한 뒤 다시 시도해 주세요. 샘플 동작도 이용할 수 있어요."
            : error instanceof DOMException && error.name === "NotFoundError"
              ? "사용할 수 있는 카메라가 없어요. 샘플 동작을 이용해 주세요."
              : "카메라를 연결하지 못했어요. 다른 앱의 카메라 사용과 권한을 확인해 주세요.",
        );
      }
    },
    [cleanup, video, profile],
  );

  const confirm = () =>
    setState((current) =>
      current.result?.decision === "detected"
        ? {
            ...current,
            message:
              current.source === "sample"
                ? "샘플 시연 결과를 확인했어요."
                : "동작 인증을 확인했어요. 퀘스트 화면에서 완료해 주세요.",
            result: { ...current.result, userConfirmed: true },
          }
        : current,
    );
  return { ...state, selectedRegion, selectRegion, bindVideo, start, cancel, confirm };
}
