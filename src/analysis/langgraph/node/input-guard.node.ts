import { GraphState } from '../state.js';

const LOG_PREFIX = '[analysis]';

export const inputGuardNode = async (state: GraphState): Promise<GraphState> => {
  const cleanedFiles = state.input.files
    .filter(
      (file) =>
        file.patch.trim().length > 0 ||
        file.content.trim().length > 0 ||
        file.baseContent.trim().length > 0,
    )

  console.log(
    `${LOG_PREFIX} inputGuard: ${state.input.files.length} → ${cleanedFiles.length} files`,
  );

  return {
    ...state,
    cleanedInput: {
      ...state.input,
      files: cleanedFiles,
    },
  };
};
