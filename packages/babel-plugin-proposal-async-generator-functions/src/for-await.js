import { types as t, template } from "@babel/core";

const forAwaitBuilders = [
  template.statement(`
    async function wrapper() {
      for (
        var ITERATOR_KEY = GET_ITERATOR(OBJECT), STEP_SYNC, STEP_VALUE;
        (
          STEP_SYNC = await ITERATOR_KEY.next(),
          ITERATOR_COMPLETION = STEP_SYNC.done,
          STEP_VALUE = await STEP_SYNC.value,
          !ITERATOR_COMPLETION
        );
        ITERATOR_COMPLETION = true) {
      }
    }`),
  template.statement(`
    async function wrapper() {
      for (
        var ITERATOR_KEY = GET_ITERATOR(OBJECT), STEP_KEY, STEP_SYNC, STEP_VALUE, STEP_VALUE_SYNC;
        (
          STEP_KEY = ITERATOR_KEY.next(),
          STEP_SYNC = STEP_KEY instanceof Promise ? await STEP_KEY : STEP_KEY,
          ITERATOR_COMPLETION = STEP_SYNC.done,
          STEP_VALUE = STEP_SYNC.value
          STEP_VALUE_SYNC = STEP_VALUE instanceof Promise ? await STEP_VALUE : STEP_VALUE,
          !ITERATOR_COMPLETION
        );
        ITERATOR_COMPLETION = true) {
      }
    }`),
];

const forAwaitWrapperBuilder = template(`
  async function wrapper() {
    var ITERATOR_COMPLETION = true;
    var ITERATOR_HAD_ERROR_KEY = false;
    var ITERATOR_ERROR_KEY;
    try {
    } catch (err) {
      ITERATOR_HAD_ERROR_KEY = true;
      ITERATOR_ERROR_KEY = err;
    } finally {
      try {
        if (!ITERATOR_COMPLETION && ITERATOR_KEY.return != null) {
          await ITERATOR_KEY.return();
        }
      } finally {
        if (ITERATOR_HAD_ERROR_KEY) {
          throw ITERATOR_ERROR_KEY;
        }
      }
    }
  }
`);

const stripAsyncWrapper = node => node.body.body;

export default function (path, { getIterator }) {
  const { node, scope, parent } = path;

  const iterator = scope.generateUidIdentifier("iterator");
  const iteratorCompletion = scope.generateUidIdentifier(
    "iteratorNormalCompletion",
  );
  const stepValue = scope.generateUidIdentifier("value");
  const left = node.left;
  const sync = node.sync || false;
  let declar;

  if (t.isIdentifier(left) || t.isPattern(left) || t.isMemberExpression(left)) {
    // for await (i of test), for await ({ i } of test)
    declar = t.expressionStatement(
      t.assignmentExpression("=", left, stepValue),
    );
  } else if (t.isVariableDeclaration(left)) {
    // for await (let i of test)
    declar = t.variableDeclaration(left.kind, [
      t.variableDeclarator(left.declarations[0].id, stepValue),
    ]);
  }
  const tryWrapper = stripAsyncWrapper(
    forAwaitWrapperBuilder({
      ITERATOR_HAD_ERROR_KEY: scope.generateUidIdentifier("didIteratorError"),
      ITERATOR_COMPLETION: iteratorCompletion,
      ITERATOR_ERROR_KEY: scope.generateUidIdentifier("iteratorError"),
      ITERATOR_KEY: iterator,
    }),
  );
  let loop = stripAsyncWrapper(
    forAwaitBuilders[Number(sync)]({
      ITERATOR_KEY: t.cloneNode(iterator),
      ITERATOR_COMPLETION: t.cloneNode(iteratorCompletion),
      GET_ITERATOR: getIterator,
      OBJECT: node.right,
      STEP_VALUE: t.cloneNode(stepValue),
      STEP_SYNC: scope.generateUidIdentifier(sync ? "stepSync" : "step"),
      ...(sync
        ? {
            STEP_KEY: scope.generateUidIdentifier("step"),
            STEP_VALUE_SYNC: scope.generateUidIdentifier("valueSync"),
          }
        : {}),
    }),
  )[0];

  const isLabeledParent = t.isLabeledStatement(parent);

  if (isLabeledParent) {
    loop = t.labeledStatement(parent.label, loop);
  }

  tryWrapper[3].block.body[0] = loop;

  return {
    replaceParent: isLabeledParent,
    node: tryWrapper,
    declar,
    loop,
  };
}
