export default function condition(
  options: { env: string } = { env: 'browser' },
) {
  const env = options.env || 'browser';

  const reg = /\s*\/\/\s#if\s+\[(.+?)\]\s*\n([\s\S]*?)\n\s*\/\/\s#endif\s*/gi;
  return {
    name: 'rollup-plugin-conditional',

    transform(code: string, id: string) {
      const conditionedCode = code.replace(reg, (all, p1, p2) => {
        console.log(p1);
        return p1.toLowerCase() === env.toLowerCase() ? p2 : '';
      });
      const result = {
        code: conditionedCode,
      };
      return result;
    },
  };
}
