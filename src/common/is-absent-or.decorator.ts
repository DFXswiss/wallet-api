import { ValidateIf } from 'class-validator';

// Like `@IsOptional()`, but only an absent field (`undefined`) skips the property's other validators. JSON `null` is
// still validated, so `null` on an optional field fails the type check and answers 400 `BadRequest`, as documented.
export function IsAbsentOr(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined);
}
