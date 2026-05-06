# Bugfix Requirements Document

## Introduction

The build is currently blocked by a critical syntax error in `electron/services/WorkbenchSessionManager_new.ts` at lines 71-85. Two function bodies exist without their function signatures, causing TypeScript compilation to fail. This prevents the application from building and running with `bun run dev`.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the TypeScript compiler processes `electron/services/WorkbenchSessionManager_new.ts` at lines 71-77 THEN the system encounters an orphaned function body starting with `const normalized = path.normalize(trimmed)...` without a function signature

1.2 WHEN the TypeScript compiler processes `electron/services/WorkbenchSessionManager_new.ts` at lines 81-85 THEN the system encounters another orphaned function body starting with `const basename = path.basename(normalizedPath)...` without a function signature

1.3 WHEN running `bun run dev` THEN the build fails with syntax errors preventing the application from starting

### Expected Behavior (Correct)

2.1 WHEN the TypeScript compiler processes `electron/services/WorkbenchSessionManager_new.ts` at lines 71-77 THEN the system SHALL successfully compile a complete function definition with proper signature and body

2.2 WHEN the TypeScript compiler processes `electron/services/WorkbenchSessionManager_new.ts` at lines 81-85 THEN the system SHALL successfully compile a complete function definition with proper signature and body

2.3 WHEN running `bun run dev` THEN the build SHALL complete successfully without syntax errors

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the TypeScript compiler processes other functions in `WorkbenchSessionManager_new.ts` THEN the system SHALL CONTINUE TO compile them successfully

3.2 WHEN the application uses `normalizeWorkspaceId()` function (line 68) THEN the system SHALL CONTINUE TO execute it correctly

3.3 WHEN the application uses `buildSessionKey()` function (line 88) THEN the system SHALL CONTINUE TO execute it correctly

3.4 WHEN the WorkbenchSessionManager class is instantiated THEN the system SHALL CONTINUE TO function as designed

## Bug Condition Analysis

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type SourceCodeLine
  OUTPUT: boolean
  
  // Returns true when a line is part of an orphaned function body
  RETURN (X.lineNumber >= 71 AND X.lineNumber <= 77 AND X.file = "WorkbenchSessionManager_new.ts")
         OR (X.lineNumber >= 81 AND X.lineNumber <= 85 AND X.file = "WorkbenchSessionManager_new.ts")
END FUNCTION
```

### Property Specification

```pascal
// Property: Fix Checking - Complete Function Definitions
FOR ALL X WHERE isBugCondition(X) DO
  result ← compile'(X)
  ASSERT result.success = true AND result.hasCompleteFunctionDefinition = true
END FOR
```

### Preservation Goal

```pascal
// Property: Preservation Checking - Other Functions Unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT compile(X) = compile'(X)
END FOR
```

Where:
- **compile**: The original compilation result (fails on buggy lines)
- **compile'**: The fixed compilation result (succeeds on all lines)
- **X**: A source code line in the file

## Counterexample

**Input:** `electron/services/WorkbenchSessionManager_new.ts` lines 71-85

**Current Output:** TypeScript compilation error - orphaned function bodies without signatures

**Expected Output:** Successful compilation with complete function definitions
