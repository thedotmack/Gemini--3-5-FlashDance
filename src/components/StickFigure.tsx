import React from "react";
import { motion } from "motion/react";
import { DanceStep } from "../types";

interface StickFigureProps {
  step: DanceStep;
  width?: number;
  height?: number;
  highlightJoints?: boolean;
}

export default function StickFigure({
  step,
  width = 240,
  height = 280,
  highlightJoints = true
}: StickFigureProps) {
  // Graceful fallback coordinate values if any are missing
  const head = step.head || { x: 50, y: 22 };
  const neck = step.neck || { x: 50, y: 32 };
  const pelvis = step.pelvis || { x: 50, y: 68 };
  const leftShoulder = step.leftShoulder || { x: 40, y: 34 };
  const rightShoulder = step.rightShoulder || { x: 60, y: 34 };
  const leftElbow = step.leftElbow || { x: 30, y: 44 };
  const rightElbow = step.rightElbow || { x: 70, y: 44 };
  const leftHand = step.leftHand || { x: 20, y: 50 };
  const rightHand = step.rightHand || { x: 80, y: 50 };
  const leftHip = step.leftHip || { x: 44, y: 68 };
  const rightHip = step.rightHip || { x: 56, y: 68 };
  const leftKnee = step.leftKnee || { x: 44, y: 88 };
  const rightKnee = step.rightKnee || { x: 56, y: 88 };
  const leftFoot = step.leftFoot || { x: 44, y: 110 };
  const rightFoot = step.rightFoot || { x: 56, y: 110 };

  const activeColor = "#6366f1"; // Indigo-500
  const secondaryColor = "#f1f5f9"; // Slate offwhite
  const jointColor = "#06b6d4"; // Cyan-500
  const floorColor = "#475569"; // Slate-600

  // Function to render face expressions on the head
  const renderFace = () => {
    const expr = step.faceExpression?.toLowerCase() || "neutral";
    // Head diameter is 20, center is (head.x, head.y)
    // Left eye approx: head.x - 3.5, head.y - 2
    // Right eye approx: head.x + 3.5, head.y - 2
    switch (expr) {
      case "smile":
      case "excited":
        return (
          <>
            {/* Eyes */}
            <circle cx={head.x - 3.5} cy={head.y - 2} r="1.5" fill="#020617" />
            <circle cx={head.x + 3.5} cy={head.y - 2} r="1.5" fill="#020617" />
            {/* Smiling mouth */}
            <path
              d={`M ${head.x - 4} ${head.y + 2.5} Q ${head.x} ${head.y + 6.5} ${head.x + 4} ${head.y + 2.5}`}
              fill="none"
              stroke="#020617"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        );
      case "wink":
        return (
          <>
            {/* Eyes - Left wink (arc), Right open */}
            <path
              d={`M ${head.x - 5} ${head.y - 1} Q ${head.x - 3.5} ${head.y - 3} ${head.x - 2} ${head.y - 1}`}
              fill="none"
              stroke="#020617"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx={head.x + 3.5} cy={head.y - 2} r="1.5" fill="#020617" />
            {/* Smile */}
            <path
              d={`M ${head.x - 3.5} ${head.y + 3} Q ${head.x} ${head.y + 6.2} ${head.x + 3.5} ${head.y + 3}`}
              fill="none"
              stroke="#020617"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </>
        );
      case "cool":
        return (
          <>
            {/* Cool Sunglasses */}
            <path
              d={`M ${head.x - 6.5} ${head.y - 2} L ${head.x + 6.5} ${head.y - 2}`}
              stroke="#020617"
              strokeWidth="1.5"
            />
            <rect x={head.x - 5.5} y={head.y - 2.5} width="4.5" height="3" rx="1" fill="#020617" />
            <rect x={head.x + 1} y={head.y - 2.5} width="4.5" height="3" rx="1" fill="#020617" />
            {/* Neutral smirk */}
            <path
              d={`M ${head.x - 3} ${head.y + 3.5} L ${head.x + 3} ${head.y + 3}`}
              fill="none"
              stroke="#020617"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        );
      case "focus":
        return (
          <>
            {/* Focused Eyes - Flat lines */}
            <line x1={head.x - 5} y1={head.y - 2} x2={head.x - 2} y2={head.y - 2} stroke="#020617" strokeWidth="1.5" />
            <line x1={head.x + 2} y1={head.y - 2} x2={head.x + 5} y2={head.y - 2} stroke="#020617" strokeWidth="1.5" />
            {/* Determined flat mouth */}
            <line x1={head.x - 3.5} y1={head.y + 3.5} x2={head.x + 3.5} y2={head.y + 3.5} stroke="#020617" strokeWidth="1.5" strokeLinecap="round" />
          </>
        );
      case "neutral":
      default:
        return (
          <>
            {/* Eyes */}
            <circle cx={head.x - 3.5} cy={head.y - 2} r="1.2" fill="#020617" />
            <circle cx={head.x + 3.5} cy={head.y - 2} r="1.2" fill="#020617" />
            {/* Small subtle smile */}
            <path
              d={`M ${head.x - 3} ${head.y + 3} Q ${head.x} ${head.y + 5} ${head.x + 3} ${head.y + 3}`}
              fill="none"
              stroke="#020617"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </>
        );
    }
  };

  const transitionSettings = { type: "spring", stiffness: 85, damping: 15 };

  return (
    <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-slate-950/60 border border-slate-800/80 shadow-inner">
      <svg
        id={`stick_svg_${step.stepNumber}`}
        viewBox="0 0 100 120"
        width={width}
        height={height}
        className="overflow-visible"
      >
        {/* Dynamic Glowing Dance Floor Shadow */}
        <ellipse cx="50" cy="115" rx="35" ry="4" fill="rgba(99, 102, 241, 0.25)" className="blur-xs" />
        <line x1="15" y1="115" x2="85" y2="115" stroke={floorColor} strokeWidth="1.5" strokeLinecap="round" />

        {/* --- BONES RENDERED WITH DYNAMIC SPRING TRANSITIONS --- */}

        {/* Shoulders bridge */}
        <motion.line initial={false}
          x1={leftShoulder.x}
          y1={leftShoulder.y}
          x2={rightShoulder.x}
          y2={rightShoulder.y}
          stroke={secondaryColor}
          strokeWidth="3.5"
          strokeLinecap="round"
          animate={{ x1: leftShoulder.x, y1: leftShoulder.y, x2: rightShoulder.x, y2: rightShoulder.y }}
          transition={transitionSettings}
        />

        {/* Pelvis bridge */}
        <motion.line initial={false}
          x1={leftHip.x}
          y1={leftHip.y}
          x2={rightHip.x}
          y2={rightHip.y}
          stroke={secondaryColor}
          strokeWidth="3.5"
          strokeLinecap="round"
          animate={{ x1: leftHip.x, y1: leftHip.y, x2: rightHip.x, y2: rightHip.y }}
          transition={transitionSettings}
        />

        {/* Spine: Neck to Pelvis */}
        <motion.line initial={false}
          x1={neck.x}
          y1={neck.y}
          x2={pelvis.x}
          y2={pelvis.y}
          stroke={secondaryColor}
          strokeWidth="4"
          strokeLinecap="round"
          animate={{ x1: neck.x, y1: neck.y, x2: pelvis.x, y2: pelvis.y }}
          transition={transitionSettings}
        />

        {/* Left Arm: Left Shoulder -> Left Elbow -> Left Hand */}
        <motion.line initial={false}
          x1={leftShoulder.x}
          y1={leftShoulder.y}
          x2={leftElbow.x}
          y2={leftElbow.y}
          stroke={activeColor}
          strokeWidth="3"
          strokeLinecap="round"
          animate={{ x1: leftShoulder.x, y1: leftShoulder.y, x2: leftElbow.x, y2: leftElbow.y }}
          transition={transitionSettings}
        />
        <motion.line initial={false}
          x1={leftElbow.x}
          y1={leftElbow.y}
          x2={leftHand.x}
          y2={leftHand.y}
          stroke={activeColor}
          strokeWidth="3"
          strokeLinecap="round"
          animate={{ x1: leftElbow.x, y1: leftElbow.y, x2: leftHand.x, y2: leftHand.y }}
          transition={transitionSettings}
        />

        {/* Right Arm: Right Shoulder -> Right Elbow -> Right Hand */}
        <motion.line initial={false}
          x1={rightShoulder.x}
          y1={rightShoulder.y}
          x2={rightElbow.x}
          y2={rightElbow.y}
          stroke={activeColor}
          strokeWidth="3"
          strokeLinecap="round"
          animate={{ x1: rightShoulder.x, y1: rightShoulder.y, x2: rightElbow.x, y2: rightElbow.y }}
          transition={transitionSettings}
        />
        <motion.line initial={false}
          x1={rightElbow.x}
          y1={rightElbow.y}
          x2={rightHand.x}
          y2={rightHand.y}
          stroke={activeColor}
          strokeWidth="3"
          strokeLinecap="round"
          animate={{ x1: rightElbow.x, y1: rightElbow.y, x2: rightHand.x, y2: rightHand.y }}
          transition={transitionSettings}
        />

        {/* Left Leg: Left Hip -> Left Knee -> Left Foot */}
        <motion.line initial={false}
          x1={leftHip.x}
          y1={leftHip.y}
          x2={leftKnee.x}
          y2={leftKnee.y}
          stroke={secondaryColor}
          strokeWidth="3.5"
          strokeLinecap="round"
          animate={{ x1: leftHip.x, y1: leftHip.y, x2: leftKnee.x, y2: leftKnee.y }}
          transition={transitionSettings}
        />
        <motion.line initial={false}
          x1={leftKnee.x}
          y1={leftKnee.y}
          x2={leftFoot.x}
          y2={leftFoot.y}
          stroke={secondaryColor}
          strokeWidth="3.5"
          strokeLinecap="round"
          animate={{ x1: leftKnee.x, y1: leftKnee.y, x2: leftFoot.x, y2: leftFoot.y }}
          transition={transitionSettings}
        />

        {/* Right Leg: Right Hip -> Right Knee -> Right Foot */}
        <motion.line initial={false}
          x1={rightHip.x}
          y1={rightHip.y}
          x2={rightKnee.x}
          y2={rightKnee.y}
          stroke={secondaryColor}
          strokeWidth="3.5"
          strokeLinecap="round"
          animate={{ x1: rightHip.x, y1: rightHip.y, x2: rightKnee.x, y2: rightKnee.y }}
          transition={transitionSettings}
        />
        <motion.line initial={false}
          x1={rightKnee.x}
          y1={rightKnee.y}
          x2={rightFoot.x}
          y2={rightFoot.y}
          stroke={secondaryColor}
          strokeWidth="3.5"
          strokeLinecap="round"
          animate={{ x1: rightKnee.x, y1: rightKnee.y, x2: rightFoot.x, y2: rightFoot.y }}
          transition={transitionSettings}
        />

        {/* --- HEAD AND FACE --- */}
        <motion.g
          animate={{ x: 0, y: 0 }}
          transition={transitionSettings}
        >
          {/* Head frame */}
          <motion.circle initial={false}
            cx={head.x}
            cy={head.y}
            r="9.5"
            fill="#e2e8f0"
            stroke={secondaryColor}
            strokeWidth="1.5"
            animate={{ cx: head.x, cy: head.y }}
            transition={transitionSettings}
          />
          {/* Facial features (Rendered dynamically) */}
          {renderFace()}
        </motion.g>

        {/* --- OPTIONAL GLOWING JOINTS HIGHLIGHT --- */}
        {highlightJoints && (
          <>
            {/* Left Hand joint highlight */}
            <motion.circle initial={false}
              cx={leftHand.x}
              cy={leftHand.y}
              r="3.5"
              fill={jointColor}
              animate={{ cx: leftHand.x, cy: leftHand.y }}
              transition={transitionSettings}
            />
            {/* Right Hand joint highlight */}
            <motion.circle initial={false}
              cx={rightHand.x}
              cy={rightHand.y}
              r="3.5"
              fill={jointColor}
              animate={{ cx: rightHand.x, cy: rightHand.y }}
              transition={transitionSettings}
            />
            {/* Left Foot joint highlight */}
            <motion.circle initial={false}
              cx={leftFoot.x}
              cy={leftFoot.y}
              r="3.5"
              fill={jointColor}
              animate={{ cx: leftFoot.x, cy: leftFoot.y }}
              transition={transitionSettings}
            />
            {/* Right Foot joint highlight */}
            <motion.circle initial={false}
              cx={rightFoot.x}
              cy={rightFoot.y}
              r="3.5"
              fill={jointColor}
              animate={{ cx: rightFoot.x, cy: rightFoot.y }}
              transition={transitionSettings}
            />
          </>
        )}
      </svg>
    </div>
  );
}
