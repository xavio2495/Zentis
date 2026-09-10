import { render, Box, Text, useApp, useInput } from "ink";
import { useState } from "react";

function Hello() {
  const { exit } = useApp();
  const [keys, setKeys] = useState<string[]>([]);
  useInput((input, key) => {
    if (input === "x") {
      exit();
      return;
    }
    setKeys((prev) => [...prev, key.return ? "<return>" : input].slice(-8));
  });
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text color="cyan">zentis tui · gate 0</Text>
      <Text>raw input: {keys.length === 0 ? "(press keys; x quits)" : keys.join(" ")}</Text>
    </Box>
  );
}

render(<Hello />);
