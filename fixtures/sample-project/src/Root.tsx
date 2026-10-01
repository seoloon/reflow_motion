import { Composition, Still } from "remotion";
import { HelloWorld } from "./HelloWorld";

const FPS = 30;

export const Root = () => (
  <>
    <Composition
      id="HelloWorld"
      component={HelloWorld}
      width={1920}
      height={1080}
      fps={FPS}
      durationInFrames={FPS * 4}
      defaultProps={{ title: "Hello ReFlow", color: "#ffffff", opacity: 1, offset: { x: 0, y: 0 }, uppercase: false }}
    />
    <Still
      id="Poster"
      component={HelloWorld}
      width={1080}
      height={1350}
      defaultProps={{ title: "Poster", color: "#ff5a3c", opacity: 1, offset: { x: 0, y: 0 }, uppercase: true }}
    />
  </>
);
