import type { ComponentConfig, DefaultComponentProps, ObjectField } from '@puckeditor/core';
import type { CSSProperties } from 'react';
import { forwardRef, type ReactNode } from 'react';

type LayoutFieldProps = {
  padding?: string;
  spanCol?: number;
  spanRow?: number;
  /** String 'true'/'false' from radio field, or boolean from legacy saved data */
  grow?: boolean | 'true' | 'false';
};

export type WithLayout<Props extends DefaultComponentProps> = Props & {
  layout?: LayoutFieldProps;
};

type LayoutProps = WithLayout<{
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}>;

export const layoutField: ObjectField<LayoutFieldProps> = {
  type: 'object',
  objectFields: {
    spanCol: {
      label: 'Grid Columns',
      type: 'number',
      min: 1,
      max: 12,
    },
    spanRow: {
      label: 'Grid Rows',
      type: 'number',
      min: 1,
      max: 12,
    },
    grow: {
      label: 'Flex Grow',
      type: 'radio',
      options: [
        { label: 'true', value: 'true' },
        { label: 'false', value: 'false' },
      ],
    },
    padding: {
      type: 'select',
      label: 'Vertical Padding',
      options: [
        { label: '0px', value: '0px' },
        { label: '8px', value: '8px' },
        { label: '16px', value: '16px' },
        { label: '24px', value: '24px' },
        { label: '32px', value: '32px' },
        { label: '40px', value: '40px' },
        { label: '48px', value: '48px' },
        { label: '56px', value: '56px' },
        { label: '64px', value: '64px' },
        { label: '72px', value: '72px' },
        { label: '80px', value: '80px' },
        { label: '88px', value: '88px' },
        { label: '96px', value: '96px' },
        { label: '104px', value: '104px' },
        { label: '112px', value: '112px' },
        { label: '120px', value: '120px' },
        { label: '128px', value: '128px' },
      ],
    },
  },
};

const Layout = forwardRef<HTMLDivElement, LayoutProps>(({ children, className, layout, style }, ref) => {
  return (
    <div
      className={className}
      ref={ref}
      style={{
        gridColumn: layout?.spanCol ? `span ${Math.max(Math.min(layout.spanCol, 12), 1)}` : undefined,
        gridRow: layout?.spanRow ? `span ${Math.max(Math.min(layout.spanRow, 12), 1)}` : undefined,
        paddingTop: layout?.padding,
        paddingBottom: layout?.padding,
        flex: layout?.grow === true || layout?.grow === 'true' ? '1 1 0' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
});

Layout.displayName = 'Layout';

export { Layout };

// biome-ignore lint/suspicious/noExplicitAny: required by Puck's generic HOC type constraint pattern
export function withLayout<ThisComponentConfig extends ComponentConfig<any> = ComponentConfig<any>>(
  componentConfig: ThisComponentConfig,
): ThisComponentConfig {
  return {
    ...componentConfig,
    fields: {
      ...componentConfig.fields,
      layout: layoutField,
    },
    defaultProps: {
      ...componentConfig.defaultProps,
      layout: {
        spanCol: 1,
        spanRow: 1,
        padding: '0px',
        grow: 'false',
        ...componentConfig.defaultProps?.layout,
      },
    },
    resolveFields: (data, params) => {
      // Compose: run the wrapped component's resolveFields first (if any), then add layout fields
      const baseFields = componentConfig.resolveFields
        ? componentConfig.resolveFields(data, params)
        : componentConfig.fields;

      if (params.parent?.type === 'Grid') {
        return {
          ...baseFields,
          layout: {
            ...layoutField,
            objectFields: {
              spanCol: layoutField.objectFields.spanCol,
              spanRow: layoutField.objectFields.spanRow,
              padding: layoutField.objectFields.padding,
            },
          },
        };
      }
      if (params.parent?.type === 'Flex') {
        return {
          ...baseFields,
          layout: {
            ...layoutField,
            objectFields: {
              grow: layoutField.objectFields.grow,
              padding: layoutField.objectFields.padding,
            },
          },
        };
      }

      return {
        ...baseFields,
        layout: {
          ...layoutField,
          objectFields: {
            padding: layoutField.objectFields.padding,
          },
        },
      };
    },
    inline: true,
    render: (props) => (
      <Layout className="puck-layout" layout={props.layout as LayoutFieldProps} ref={props.puck.dragRef}>
        {componentConfig.render(props)}
      </Layout>
    ),
  };
}
