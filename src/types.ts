export interface JointPosition {
  x: number;
  y: number;
}

export interface DanceStep {
  stepNumber: number;
  name: string;
  description: string;
  beats: string;
  head: JointPosition;
  neck: JointPosition;
  pelvis: JointPosition;
  leftShoulder: JointPosition;
  rightShoulder: JointPosition;
  leftElbow: JointPosition;
  leftHand: JointPosition;
  rightElbow: JointPosition;
  rightHand: JointPosition;
  leftHip: JointPosition;
  rightHip: JointPosition;
  leftKnee: JointPosition;
  leftFoot: JointPosition;
  rightKnee: JointPosition;
  rightFoot: JointPosition;
  faceExpression?: string;
  videoLoopStart?: number;
  videoLoopEnd?: number;
}

export interface DanceRoutine {
  songTitle: string;
  artist: string;
  genre?: string;
  tempoBpm?: number;
  styleDescription: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  steps: DanceStep[];
}

export interface YouTubeVideoInfo {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  channelTitle: string;
  publishedAt: string;
  videoUrl?: string;
}
